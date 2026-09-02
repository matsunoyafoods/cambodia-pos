'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CartLine, MenuItem } from '@/lib/pos-types';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';
import { getPosMenus, getPosSettings, PosApiError } from '@/lib/api-client';
import { getPosOrderMenu, getPosOrderMode, getPosOrderSettings, getPosOrderTableLayout, PosOrderApiError } from '@/lib/pos-order-client';
import {
  confirmOrderItems,
  createOpenOrder,
  deleteConfirmedItem,
  enqueueKitchenPrintJob,
  getOpenOrder,
  updateConfirmedItemQty,
  PosOrderOrdersApiError,
  type OpenOrderRecord,
  type OrderItemRecord,
} from '@/lib/pos-order-orders-client';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import { extendDrinkTimer, getTableSessions, startDrinkTimer, startTableStay, type TableSessionRecord } from '@/lib/table-session-client';
import { effectiveBasePrice, isHappyHourNow } from '@/lib/happy-hour';
import { cartLineNetTotal } from '@/lib/cart';
import { HandyOrderScreen } from './handy-order-screen';
import { OptionModal, type ModalSelection } from './option-modal';
import { LanguageProvider, useLanguage, GUEST_LANGUAGE_STORAGE_KEY } from './language-context';
import { LanguagePickerScreen } from './language-picker-screen';

// QRセルフオーダー画面 (2026-08-31 追加。「QRコードを読み込んでセルフオーダーもできるし、
// スタッフがさわればハンディー機能としても使えるようにしたい」への対応)。
//
// この画面は認証なしの公開ページ (/order/[tableCode])。ハンディ (handy-app.tsx) と全く同じ
// 注文入力UI (handy-order-screen.tsx) をそのまま流用することで、「お客様がQRから自分で
// 注文する」のと「スタッフがこの画面を(自分のスマホ等で)開いてハンディ代わりに使う」の
// 両方を同じ画面・同じコードで実現している。ハンディとの違いは:
//   - 卓一覧が無い (QRコードに卓番号が埋め込まれているため、最初からその卓の注文画面を表示)
//   - スタッフPINログイン不要 (ハンディと同様、会計を含まないので不要)
//   - 「卓をリセット」「卓一覧へ戻る」等スタッフ専用の操作は非表示 (handy-order-screen.tsx の
//     guestMode で制御。誤ってお客様が伝票を破棄できてしまうことを防ぐ)
//   - 注文確定後は「注文を送信しました」の確認画面を挟む (Tom確認済みの仕様)
// バックエンドは /api/pos-order/* を共有しており、レジ・ハンディ・QRのどれが操作しても
// 同じ卓の open 注文に安全に追記されるだけ (multi-tenant-productization-spec.md §0.1c 参照)。
//
// 客層記録 (人種構成・子供人数) は 2026-08-31 の変更 (§0.1d) により、卓を開く時点では不要に
// なった (会計時にレジが別途記録する)。そのため QR から直接卓を開いても客層記録の入力を
// 求める必要がない。

// 多言語化 (2026-09-02 追加)。QRセルフオーダーは客側画面なので、専用の言語コンテキスト
// (GUEST_LANGUAGE_STORAGE_KEY) でラップする。初回アクセス時だけ言語選択画面を挟み、
// 選択後はこのブラウザでは以降スキップされる (Tom確認済みの仕様)。
export function QrOrderApp({ tableCode }: { tableCode: string }) {
  return (
    <LanguageProvider storageKey={GUEST_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <QrOrderAppInner tableCode={tableCode} />
    </LanguageProvider>
  );
}

function QrOrderAppInner({ tableCode }: { tableCode: string }) {
  const { t, setLang, menuText } = useLanguage();
  const [languageChosen, setLanguageChosen] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setLanguageChosen(!!window.localStorage.getItem(GUEST_LANGUAGE_STORAGE_KEY));
    } catch {
      setLanguageChosen(false);
    }
  }, []);

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [layoutItems, setLayoutItems] = useState<TableLayoutItemRecord[]>([]);
  const [session, setSession] = useState<TableSessionRecord | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [tableInvalid, setTableInvalid] = useState(false);
  const [loadToken, setLoadToken] = useState(0);

  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [optionModalItem, setOptionModalItem] = useState<MenuItem | null>(null);
  const [optionSelection, setOptionSelection] = useState<ModalSelection>({});

  const [currentOrder, setCurrentOrder] = useState<OpenOrderRecord | null>(null);
  const [confirmedItems, setConfirmedItems] = useState<OrderItemRecord[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // 注文送信直後の確認画面 (「注文を送信しました」+ 追加注文へ戻るボタン。2026-08-31 追加)。
  const [submitted, setSubmitted] = useState(false);

  const [posNativeCategoryOrder, setPosNativeCategoryOrder] = useState<string[] | null>(null);
  const categories = useMemo(() => {
    if (posNativeCategoryOrder) {
      const present = new Set(menu.map((m) => m.category));
      return posNativeCategoryOrder.filter((c) => present.has(c));
    }
    const seen: string[] = [];
    for (const m of menu) {
      if (!seen.includes(m.category)) seen.push(m.category);
    }
    return seen;
  }, [menu, posNativeCategoryOrder]);

  useEffect(() => {
    let cancelled = false;
    setDataLoading(true);
    setDataError(null);
    setTableInvalid(false);
    (async () => {
      try {
        const { menuSource } = await getPosOrderMode();
        const layoutData = await getPosOrderTableLayout().catch(() => ({ items: [] as TableLayoutItemRecord[] }));
        const realTables = layoutData.items.filter((t) => t.kind === 'table');
        // レイアウトが登録済みの店舗では、実在しない卓コードでのアクセスを弾く
        // (QRコードの読み取りミス・URL手打ち等への保険)。
        if (realTables.length > 0 && !realTables.some((t) => t.table_code === tableCode)) {
          if (cancelled) return;
          setTableInvalid(true);
          setDataLoading(false);
          return;
        }
        const sessionsData = await getTableSessions().catch(() => ({ items: [] as TableSessionRecord[] }));
        if (menuSource === 'pos_native') {
          const [menuData, settingsData] = await Promise.all([getPosOrderMenu(), getPosOrderSettings()]);
          if (cancelled) return;
          setMenu(menuData.items);
          setPosNativeCategoryOrder(menuData.categories);
          setSettings((prev) => ({ ...prev, ...settingsData }));
        } else {
          const [menuData, settingsData] = await Promise.all([getPosMenus(), getPosSettings()]);
          if (cancelled) return;
          setMenu(
            menuData.map((m) => {
              const category = m.category ?? '未分類';
              return { ...m, category, minorCategory: category };
            }),
          );
          setPosNativeCategoryOrder(null);
          setSettings((prev) => ({ ...prev, ...settingsData }));
        }
        setLayoutItems(layoutData.items);
        setSession(sessionsData.items.find((s) => s.table_code === tableCode) ?? null);
        const { order, items: confirmed } = await getOpenOrder(tableCode).catch(() => ({ order: null, items: [] }));
        if (cancelled) return;
        setCurrentOrder(order);
        setConfirmedItems(confirmed);
      } catch (err) {
        if (cancelled) return;
        // API由来のメッセージ (日本語固定、稀にしか出ない) はそのまま表示し、それ以外の
        // 汎用エラーは 'generic' マーカーにして render 側で t('qr.loadError') に翻訳する。
        const message = err instanceof PosApiError || err instanceof PosOrderApiError ? err.message : 'generic';
        setDataError(message);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadToken, tableCode]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  // 他端末 (レジ・スタッフのハンディ) がこの卓に注文を追加している可能性があるため、
  // 定期的に確定済み品目・滞在タイマーを再取得する (handy-app.tsx と同じ方針)。
  useEffect(() => {
    if (dataLoading || tableInvalid) return;
    const id = setInterval(() => {
      getTableSessions()
        .then(({ items }) => setSession(items.find((s) => s.table_code === tableCode) ?? null))
        .catch(() => {});
      if (currentOrder) {
        getOpenOrder(tableCode)
          .then(({ order, items }) => {
            setCurrentOrder(order);
            setConfirmedItems(items);
          })
          .catch(() => {});
      }
    }, 15000);
    return () => clearInterval(id);
  }, [dataLoading, tableInvalid, tableCode, currentOrder]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const happyHourActive = useMemo(() => isHappyHourNow(settings, now), [settings, now]);

  function upsertLocalSession(patch: Partial<TableSessionRecord>) {
    setSession((prev) => ({
      table_code: tableCode,
      started_at: new Date().toISOString(),
      drink_timer_started_at: null,
      drink_timer_minutes: 0,
      ...prev,
      ...patch,
    }));
  }

  function onOrderItemEntered(item: MenuItem) {
    if (cart.length === 0 && !session) {
      upsertLocalSession({});
      startTableStay(tableCode).catch(() => {});
    }
    if (item.category === '飲み放題') {
      if (item.name.includes('延長')) {
        const addMinutes = 30;
        upsertLocalSession({
          drink_timer_started_at: session?.drink_timer_started_at ?? new Date().toISOString(),
          drink_timer_minutes: (session?.drink_timer_minutes ?? 0) + addMinutes,
        });
        extendDrinkTimer(tableCode, addMinutes).catch(() => {});
      } else if (!session?.drink_timer_started_at) {
        const minutes = 60;
        upsertLocalSession({ drink_timer_started_at: new Date().toISOString(), drink_timer_minutes: minutes });
        startDrinkTimer(tableCode, minutes).catch(() => {});
      }
    }
  }

  // 会計・値引きはこの画面のスコープ外 (ハンディと同じ)。
  const totals = useMemo(() => {
    const confirmedSubtotal = confirmedItems.reduce((s, it) => s + it.line_total, 0);
    const cartSubtotal = cart.reduce((s, l) => s + cartLineNetTotal(l), 0);
    const subtotal = confirmedSubtotal + cartSubtotal;
    const vat = settings.vatInclusive ? subtotal - subtotal / (1 + settings.vatRate / 100) : subtotal * (settings.vatRate / 100);
    const service = subtotal * (settings.serviceRate / 100);
    const base = settings.vatInclusive ? subtotal - vat : subtotal;
    const discountable = base + service;
    const total = Math.max(0, discountable + vat);
    return { subtotal, vat, service, total };
  }, [cart, confirmedItems, settings.vatRate, settings.vatInclusive, settings.serviceRate]);

  function addToCart(item: MenuItem) {
    onOrderItemEntered(item);
    const unitPrice = effectiveBasePrice(item, happyHourActive);
    setCart((prev) => {
      const existing = prev.find((l) => l.id === item.id);
      if (existing) return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: item.id, menuId: item.id, name: menuText(item.name, item.translations), unitPrice, qty: 1, selectedOptions: [] }];
    });
  }

  function incLine(id: string) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)));
  }
  function decLine(id: string) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0));
  }

  async function incConfirmedItemQty(itemId: string) {
    if (!currentOrder) return;
    const target = confirmedItems.find((it) => it.id === itemId);
    if (!target) return;
    const { item } = await updateConfirmedItemQty(currentOrder.id, itemId, target.qty + 1);
    setConfirmedItems((prev) => prev.map((it) => (it.id === itemId ? item : it)));
  }
  async function decConfirmedItemQty(itemId: string) {
    if (!currentOrder) return;
    const target = confirmedItems.find((it) => it.id === itemId);
    if (!target || target.qty <= 1) return;
    const { item } = await updateConfirmedItemQty(currentOrder.id, itemId, target.qty - 1);
    setConfirmedItems((prev) => prev.map((it) => (it.id === itemId ? item : it)));
  }
  async function removeConfirmedItem(itemId: string) {
    if (!currentOrder) return;
    await deleteConfirmedItem(currentOrder.id, itemId);
    setConfirmedItems((prev) => prev.filter((it) => it.id !== itemId));
  }

  function proceedAddItem(item: MenuItem) {
    if (item.optionGroups && item.optionGroups.length > 0) {
      setOptionModalItem(item);
      setOptionSelection({});
    } else {
      addToCart(item);
    }
  }

  // まだ open 注文が無ければ (=この卓のファースト注文)、客層記録なしでそのまま卓を開く
  // (§0.1d の変更により、開卓に客層記録は不要。staffId は指定しない = お客様自身が開いた卓)。
  async function onAddItem(item: MenuItem) {
    if (!currentOrder) {
      try {
        const { order } = await createOpenOrder({ tableCode });
        setCurrentOrder(order);
        proceedAddItem(item);
      } catch (err) {
        window.alert(err instanceof PosOrderOrdersApiError ? err.message : t('qr.startOrderError'));
      }
      return;
    }
    proceedAddItem(item);
  }

  async function confirmPendingCart(): Promise<boolean> {
    if (cart.length === 0) return true;
    if (!currentOrder) return false;
    setConfirming(true);
    setConfirmError(null);
    try {
      const { items } = await confirmOrderItems(currentOrder.id, cart);
      setConfirmedItems((prev) => [...prev, ...items]);
      setCart([]);
      enqueueKitchenPrintJob({
        orderId: currentOrder.id,
        tableCode,
        items: items.map((it) => ({ name: it.menu_name, qty: it.qty })),
      }).catch(() => {});
      return true;
    } catch (err) {
      setConfirmError(err instanceof PosOrderOrdersApiError ? err.message : '注文の送信に失敗しました');
      return false;
    } finally {
      setConfirming(false);
    }
  }

  async function handleSubmitOrder() {
    const ok = await confirmPendingCart();
    if (ok) setSubmitted(true);
  }

  function confirmOptionModal() {
    if (!optionModalItem) return;
    const groups = optionModalItem.optionGroups ?? [];
    if (!groups.every((g) => optionSelection[g.key])) return;
    onOrderItemEntered(optionModalItem);

    const priceDeltaTotal = groups.reduce((sum, g) => {
      const choice = g.choices.find((c) => c.id === optionSelection[g.key]);
      return sum + (choice ? choice.priceDelta : 0);
    }, 0);
    const optionLabel = groups
      .map((g) => {
        const choice = g.choices.find((c) => c.id === optionSelection[g.key]);
        return choice ? menuText(choice.label, choice.translations) : '';
      })
      .join('・');
    const lineId = optionModalItem.id + ':' + groups.map((g) => optionSelection[g.key]).join(',');
    const unitPrice = effectiveBasePrice(optionModalItem, happyHourActive) + priceDeltaTotal;
    const selectedOptions = groups.map((g) => {
      const choice = g.choices.find((c) => c.id === optionSelection[g.key])!;
      return { groupKey: g.key, groupLabel: g.label, choiceId: choice.id, choiceLabel: choice.label, priceDelta: choice.priceDelta };
    });
    const itemDisplayName = menuText(optionModalItem.name, optionModalItem.translations);

    setCart((prev) => {
      const existing = prev.find((l) => l.id === lineId);
      if (existing) return prev.map((l) => (l.id === lineId ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: lineId, menuId: optionModalItem.id, name: `${itemDisplayName}(${optionLabel})`, unitPrice, qty: 1, selectedOptions }];
    });
    setOptionModalItem(null);
    setOptionSelection({});
  }

  // 初回アクセス時のみ言語選択画面を挟む (Tom確認済み)。まだ判定中 (null) の間はここで
  // データ読み込み中と同じ表示にしておく (言語未確定でも表示が崩れないように)。
  if (languageChosen === null) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <div className="text-sm">{t('loading.menu')}</div>
      </div>
    );
  }
  if (languageChosen === false) {
    return (
      <LanguagePickerScreen
        onSelect={(l) => {
          setLang(l);
          setLanguageChosen(true);
        }}
      />
    );
  }

  if (dataLoading) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <div className="text-sm">{t('loading.menu')}</div>
      </div>
    );
  }
  if (tableInvalid) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <div className="text-base font-semibold">{t('table.notFoundTitle')}</div>
        <div className="text-[12.5px] text-muted-foreground">{t('table.notFoundBody')}</div>
      </div>
    );
  }
  if (dataError) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-background px-8 text-center">
        <div className="text-sm font-semibold text-destructive">{dataError === 'generic' ? t('qr.loadError') : dataError}</div>
        <button onClick={() => setLoadToken((n) => n + 1)} className="h-10 rounded-lg bg-primary px-5 text-[13.5px] font-bold text-primary-foreground">
          {t('common.reload')}
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-border px-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-[13px] font-bold text-brand-foreground">住</div>
        <div className="text-[14px] font-bold tracking-tight">{t('qr.headerTitle')}</div>
      </div>

      <HandyOrderScreen
        selectedTable={tableCode}
        session={session}
        happyHourActive={happyHourActive}
        menu={menu}
        categories={categories}
        activeCategory={activeCategory}
        onCategory={setActiveCategory}
        cart={cart}
        confirmedItems={confirmedItems}
        onAddItem={onAddItem}
        onInc={incLine}
        onDec={decLine}
        onIncConfirmedItem={incConfirmedItemQty}
        onDecConfirmedItem={decConfirmedItemQty}
        onRemoveConfirmedItem={removeConfirmedItem}
        onConfirmOrder={handleSubmitOrder}
        confirming={confirming}
        confirmError={confirmError}
        subtotal={totals.subtotal}
        vat={totals.vat}
        service={totals.service}
        vatRate={settings.vatRate}
        serviceRate={settings.serviceRate}
        vatInclusive={settings.vatInclusive}
        total={totals.total}
        menuImageStyle={settings.menuImageStyle}
        onBackToTableList={() => {}}
        onResetTable={() => {}}
        guestMode
      />

      {optionModalItem && (
        <OptionModal
          item={optionModalItem}
          selection={optionSelection}
          onSelect={(groupKey, choiceId) => setOptionSelection((prev) => ({ ...prev, [groupKey]: choiceId }))}
          onClose={() => {
            setOptionModalItem(null);
            setOptionSelection({});
          }}
          onConfirm={confirmOptionModal}
        />
      )}

      {submitted && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-background px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700">✓</div>
          <div className="text-lg font-bold">{t('qr.submittedTitle')}</div>
          <div className="text-[12.5px] text-muted-foreground">{t('qr.submittedBody')}</div>
          <button
            onClick={() => setSubmitted(false)}
            className="h-12 rounded-lg bg-primary px-6 text-[14px] font-bold text-primary-foreground"
          >
            {t('qr.submittedBack')}
          </button>
        </div>
      )}
    </div>
  );
}
