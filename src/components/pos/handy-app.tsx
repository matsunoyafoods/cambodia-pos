'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CartLine, HandyTableGroup, MenuItem, TableStatus } from '@/lib/pos-types';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';
import { getPosMenus, getPosSettings, PosApiError } from '@/lib/api-client';
import {
  getPosOrderHandyTableGroups,
  getPosOrderMenu,
  getPosOrderMode,
  getPosOrderSettings,
  getPosOrderTableLayout,
  PosOrderApiError,
} from '@/lib/pos-order-client';
import {
  confirmOrderItems,
  createOpenOrder,
  deleteConfirmedItem,
  enqueueKitchenPrintJob,
  getOpenOrder,
  resetTable,
  triggerPassPrntJobs,
  updateConfirmedItemQty,
  PosOrderOrdersApiError,
  type OpenOrderRecord,
  type OrderItemRecord,
} from '@/lib/pos-order-orders-client';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import { extendDrinkTimer, getTableSessions, startDrinkTimer, startTableStay, type TableSessionRecord } from '@/lib/table-session-client';
import { effectiveBasePrice, isHappyHourNow } from '@/lib/happy-hour';
import { cartLineNetTotal } from '@/lib/cart';
import { logoutPosStaff } from '@/lib/staff-client';
import { useStaff } from './staff-context';
import { HandyTableList } from './handy-table-list';
import { HandyOrderScreen } from './handy-order-screen';
import { OptionModal, type ModalSelection } from './option-modal';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';
import { LANGS, LANG_LABEL } from '@/lib/i18n/lang';

// ハンディ (タブレット・スマホ) 向けの注文専用アプリ (2026-08-31 追加。「ハンディ注文機能」)。
// レジ画面本体 (pos-app.tsx) と同じ pos.orders/pos.table_sessions 等のAPIをそのまま共有する
// (バックエンドは端末を区別しないので、レジ・複数のハンディが同時に別の卓を担当しても
// 互いのデータを壊さない。詳細は multi-tenant-productization-spec.md §1 のstore_id分離方針、
// および注文品目は POST で追記するだけの設計のため後勝ち上書きが起きない)。
// レジ画面 (1280×800px 固定キャンバス) とは別に、フル画面・レスポンシブな専用UIとして
// 新規に組んでおり、pos-app.tsx / order-screen.tsx / table-map-screen.tsx は一切変更していない。
// スコープ: 卓選択 → 注文入力 (厨房送信) まで。会計・レシート・領収書はレジでのみ行う。
type Screen = 'tablelist' | 'order';

// 多言語化 (2026-09-02 追加)。スタッフ向け画面はデフォルト日本語のまま、ハンバーガーメニューの
// 「表示言語」から切り替える (お客様のQRセルフオーダーとは別の localStorage キーを使うため、
// 同じ端末を後でお客様がQRから使っても言語が引き継がれない)。
export function HandyApp() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <HandyAppInner />
    </LanguageProvider>
  );
}

function HandyAppInner() {
  const { t, lang, setLang, menuText } = useLanguage();
  const router = useRouter();
  const me = useStaff();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [layoutItems, setLayoutItems] = useState<TableLayoutItemRecord[]>([]);
  const [tableSessions, setTableSessions] = useState<TableSessionRecord[]>([]);
  // 卓グループ・並び順 (設定画面「ハンディ表示」タブ、2026-08-31 追加)。未設定の店舗では
  // 空配列のまま (handy-table-list.tsx 側で卓番号順にフォールバックする)。
  const [handyGroups, setHandyGroups] = useState<HandyTableGroup[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loadToken, setLoadToken] = useState(0);

  const [screen, setScreen] = useState<Screen>('tablelist');
  const [statusFilter, setStatusFilter] = useState<'all' | TableStatus>('all');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [optionModalItem, setOptionModalItem] = useState<MenuItem | null>(null);
  const [optionSelection, setOptionSelection] = useState<ModalSelection>({});

  const [currentOrder, setCurrentOrder] = useState<OpenOrderRecord | null>(null);
  const [confirmedItems, setConfirmedItems] = useState<OrderItemRecord[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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
    (async () => {
      try {
        const { menuSource } = await getPosOrderMode();
        const layoutPromise = getPosOrderTableLayout().catch(() => ({ items: [] as TableLayoutItemRecord[] }));
        const sessionsPromise = getTableSessions().catch(() => ({ items: [] as TableSessionRecord[] }));
        // 卓グループはレイアウト連携モードに関係なく卓番号ベースで動く。未設定・取得失敗時は
        // 空配列 (=グループ分けなし、卓番号順) のまま会計・注文自体は止めない。
        const handyGroupsPromise = getPosOrderHandyTableGroups().catch(() => ({ groups: [] as HandyTableGroup[] }));
        if (menuSource === 'pos_native') {
          const [menuData, settingsData, layoutData, sessionsData, handyGroupsData] = await Promise.all([
            getPosOrderMenu(),
            getPosOrderSettings(),
            layoutPromise,
            sessionsPromise,
            handyGroupsPromise,
          ]);
          if (cancelled) return;
          setMenu(menuData.items);
          setPosNativeCategoryOrder(menuData.categories);
          setSettings((prev) => ({ ...prev, ...settingsData }));
          setLayoutItems(layoutData.items);
          setTableSessions(sessionsData.items);
          setHandyGroups(handyGroupsData.groups);
        } else {
          const [menuData, settingsData, layoutData, sessionsData, handyGroupsData] = await Promise.all([
            getPosMenus(),
            getPosSettings(),
            layoutPromise,
            sessionsPromise,
            handyGroupsPromise,
          ]);
          if (cancelled) return;
          setMenu(
            menuData.map((m) => {
              const category = m.category ?? t('menu.uncategorized');
              return { ...m, category, minorCategory: category };
            }),
          );
          setPosNativeCategoryOrder(null);
          setSettings((prev) => ({ ...prev, ...settingsData }));
          setLayoutItems(layoutData.items);
          setTableSessions(sessionsData.items);
          setHandyGroups(handyGroupsData.groups);
        }
      } catch (err) {
        if (cancelled) return;
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
  }, [loadToken]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  // 卓一覧を見ている間・注文入力中とも、他端末 (レジ・他のハンディ) の操作で卓の状況が
  // 変わりうるため定期的に再取得する。
  useEffect(() => {
    if (dataLoading) return;
    const id = setInterval(() => {
      getTableSessions()
        .then(({ items }) => setTableSessions(items))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [dataLoading]);

  const tableStatus: Record<string, TableStatus> = useMemo(() => {
    const status: Record<string, TableStatus> = {};
    for (const s of tableSessions) status[s.table_code] = 'occupied';
    return status;
  }, [tableSessions]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const happyHourActive = useMemo(() => isHappyHourNow(settings, now), [settings, now]);

  function upsertLocalSession(tableCode: string, patch: Partial<TableSessionRecord>) {
    setTableSessions((prev) => {
      const idx = prev.findIndex((s) => s.table_code === tableCode);
      if (idx === -1) {
        return [...prev, { table_code: tableCode, started_at: new Date().toISOString(), drink_timer_started_at: null, drink_timer_minutes: 0, ...patch }];
      }
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function onOrderItemEntered(item: MenuItem) {
    if (!selectedTable) return;
    if (cart.length === 0 && !tableSessions.some((s) => s.table_code === selectedTable)) {
      upsertLocalSession(selectedTable, {});
      startTableStay(selectedTable).catch(() => {});
    }
    if (item.category === '飲み放題') {
      const existing = tableSessions.find((s) => s.table_code === selectedTable);
      if (item.name.includes('延長')) {
        const addMinutes = 30;
        upsertLocalSession(selectedTable, {
          drink_timer_started_at: existing?.drink_timer_started_at ?? new Date().toISOString(),
          drink_timer_minutes: (existing?.drink_timer_minutes ?? 0) + addMinutes,
        });
        extendDrinkTimer(selectedTable, addMinutes).catch(() => {});
      } else if (!existing?.drink_timer_started_at) {
        const minutes = 60;
        upsertLocalSession(selectedTable, { drink_timer_started_at: new Date().toISOString(), drink_timer_minutes: minutes });
        startDrinkTimer(selectedTable, minutes).catch(() => {});
      }
    }
  }

  // 会計・値引き機能はハンディのスコープ外のため、合計計算はクーポン・会計からの値引きを
  // 常に無しとして扱う (レジ側 pos-app.tsx の totals ロジックと式を揃えている)。
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

  function resetOrderState() {
    setOptionModalItem(null);
    setOptionSelection({});
    setConfirmError(null);
  }

  function selectTable(code: string) {
    setSelectedTable(code);
    setCart([]);
    setConfirmedItems([]);
    setCurrentOrder(null);
    setActiveCategory(categories[0] ?? '');
    resetOrderState();
    setScreen('order');
    getOpenOrder(code)
      .then(({ order, items }) => {
        setCurrentOrder(order);
        setConfirmedItems(items);
      })
      .catch(() => {});
  }

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

  // この卓でまだ open 注文が無ければ (=ファースト注文) 卓を開いてから商品を追加する。
  // 客層記録はハンディでは行わない (2026-08-31 変更: 会計機能はレジ側のみにあり、客層記録は
  // レジ画面が「会計へ進む」を押した時に別途行うようになったため。pos-app.tsx 参照)。
  async function onAddItem(item: MenuItem) {
    if (!currentOrder) {
      if (!selectedTable) return;
      try {
        const { order } = await createOpenOrder({ tableCode: selectedTable, staffId: me.id });
        setCurrentOrder(order);
        proceedAddItem(item);
      } catch (err) {
        window.alert(err instanceof PosOrderOrdersApiError ? err.message : t('handyApp.openTableError'));
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
        tableCode: selectedTable,
        items: items.map((it) => ({ name: it.menu_name, qty: it.qty })),
      })
        .then(triggerPassPrntJobs)
        .catch(() => {});
      return true;
    } catch (err) {
      setConfirmError(err instanceof PosOrderOrdersApiError ? err.message : t('handyApp.confirmError'));
      return false;
    } finally {
      setConfirming(false);
    }
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

  async function resetCurrentTable() {
    if (!selectedTable) return;
    if (!window.confirm(t('handyApp.resetConfirm', { table: selectedTable }))) return;
    try {
      await resetTable(selectedTable);
    } catch (err) {
      window.alert(err instanceof PosOrderOrdersApiError ? err.message : t('handyApp.resetError'));
      return;
    }
    setTableSessions((prev) => prev.filter((s) => s.table_code !== selectedTable));
    setScreen('tablelist');
    setSelectedTable(null);
    setCart([]);
    setConfirmedItems([]);
    setCurrentOrder(null);
    resetOrderState();
  }

  function backToTableList() {
    setScreen('tablelist');
    setSelectedTable(null);
    setCart([]);
    setConfirmedItems([]);
    setCurrentOrder(null);
    resetOrderState();
  }

  if (dataLoading) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <div className="text-sm">{t('loading.menu')}</div>
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

  const ROLE_LABEL_KEY = {
  owner: 'role.owner',
  manager: 'role.manager',
  staff: 'role.staff',
  sub_manager: 'role.sub_manager',
  employee: 'role.employee',
  part_time: 'role.part_time',
} as const;

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border px-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-[13px] font-bold text-brand-foreground">住</div>
          <div className="text-[14px] font-bold tracking-tight">{t('handyApp.title')}</div>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('handyApp.menuAriaLabel')}
            className="flex h-8 w-8 flex-col items-center justify-center gap-[3px] rounded-full bg-secondary"
          >
            <span className="h-[2px] w-3.5 rounded-full bg-foreground" />
            <span className="h-[2px] w-3.5 rounded-full bg-foreground" />
            <span className="h-[2px] w-3.5 rounded-full bg-foreground" />
          </button>
          {menuOpen && (
            <>
              <button aria-label="close menu" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-10 cursor-default" />
              <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-52 rounded-xl border border-border bg-card py-1.5 shadow-lg">
                <div className="border-b border-border px-3.5 py-2.5">
                  <div className="text-[13px] font-semibold">{me.display_name}</div>
                  <div className="text-[11px] text-muted-foreground">{t(ROLE_LABEL_KEY[me.role])}</div>
                </div>
                <div className="border-b border-border px-3.5 py-2.5">
                  <div className="mb-1.5 text-[10.5px] font-semibold text-muted-foreground">{t('handyApp.language')}</div>
                  <div className="flex flex-wrap gap-1">
                    {LANGS.map((l) => (
                      <button
                        key={l}
                        onClick={() => setLang(l)}
                        className={
                          'rounded-md border px-2 py-1 text-[11px] font-semibold ' +
                          (lang === l ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')
                        }
                      >
                        {LANG_LABEL[l]}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => router.push('/pos')} className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary">
                  {t('handyApp.goToRegister')}
                </button>
                <button onClick={() => router.push('/pos/kitchen')} className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary">
                  {t('posApp.menuKitchen')}
                </button>
                {me.authMode === 'pos_native' && (
                  <button
                    onClick={() => {
                      logoutPosStaff().finally(() => router.replace('/login?next=/pos/handy'));
                    }}
                    className="block w-full border-t border-border px-3.5 py-2 text-left text-[12.5px] text-destructive hover:bg-secondary"
                  >
                    {t('handyApp.logout')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {screen === 'tablelist' && (
        <HandyTableList
          tableStatus={tableStatus}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onSelectTable={selectTable}
          layoutItems={layoutItems}
          tableSessions={tableSessions}
          handyGroups={handyGroups}
        />
      )}

      {screen === 'order' && (
        <HandyOrderScreen
          selectedTable={selectedTable}
          session={tableSessions.find((s) => s.table_code === selectedTable) ?? null}
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
          onConfirmOrder={confirmPendingCart}
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
          onBackToTableList={backToTableList}
          onResetTable={resetCurrentTable}
        />
      )}

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
    </div>
  );
}
