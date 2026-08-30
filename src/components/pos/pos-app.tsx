'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CartLine, MenuItem, PaymentMethod, TableStatus } from '@/lib/pos-types';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';
import { getPosMenus, getPosSettings, PosApiError } from '@/lib/api-client';
import {
  getPosOrderMenu,
  getPosOrderMode,
  getPosOrderSettings,
  getPosOrderTableLayout,
  PosOrderApiError,
} from '@/lib/pos-order-client';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import { logoutPosStaff } from '@/lib/staff-client';
import { useStaff } from './staff-context';
import { TableMapScreen } from './table-map-screen';
import { OrderScreen } from './order-screen';
import { CheckoutScreen } from './checkout-screen';
import { ReceiptScreen } from './receipt-screen';
import { OptionModal, type ModalSelection } from './option-modal';

type Screen = 'tablemap' | 'order' | 'checkout' | 'receipt';

// PosApp は旧 UI プロトタイプ (design canvas の Main.dc.html) の状態遷移を
// そのまま React に移植したもの。本番接続 (Supabase / matsunoya-dine API) は
// 各 on* ハンドラの中身を差し替えていく想定 (integration-spec.md 4章のエンドポイント対応)。
export function PosApp() {
  const router = useRouter();
  const me = useStaff();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [layoutItems, setLayoutItems] = useState<TableLayoutItemRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loadToken, setLoadToken] = useState(0);

  const [screen, setScreen] = useState<Screen>('tablemap');
  const [tableStatus] = useState<Record<string, TableStatus>>({ BC3: 'occupied', C2: 'billing' });
  const [statusFilter, setStatusFilter] = useState<'all' | TableStatus>('all');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerLinked, setCustomerLinked] = useState(false);
  const [couponApplied, setCouponApplied] = useState(false);
  const [paymentTab, setPaymentTab] = useState<PaymentMethod>('cash');
  const [cashUsdReceivedStr, setCashUsdReceivedStr] = useState('');
  const [cashKhrReceivedStr, setCashKhrReceivedStr] = useState('');
  const [changeUsdStr, setChangeUsdStr] = useState('');
  const [qrConfirmed, setQrConfirmed] = useState(false);
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [optionModalItem, setOptionModalItem] = useState<MenuItem | null>(null);
  const [optionSelection, setOptionSelection] = useState<ModalSelection>({});

  // メニュー・カテゴリ一覧は初出順を維持して抽出 (matsunoya-dine 側のカテゴリ表示順に合わせる)
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const m of menu) {
      if (!seen.includes(m.category)) seen.push(m.category);
    }
    return seen;
  }, [menu]);

  // Phase C: まず /api/pos-order/mode (POS_STORE_ID 店舗の pos.integrations.menu_source) を見て、
  // 'pos_native' なら POS ネイティブの実データ (pos.menu_items 等) を、それ以外 (未移行 = 'dine_live')
  // なら従来通り matsunoya-dine 側の /api/pos/menus + /api/pos/settings を使う。
  // 連携先を切り替えていない既存店舗の挙動は変わらない (multi-tenant-productization-spec.md Phase C)。
  // loadToken を更新すると再フェッチする (エラー時の「再読み込み」ボタン用)。
  useEffect(() => {
    let cancelled = false;
    setDataLoading(true);
    setDataError(null);
    (async () => {
      try {
        const { menuSource } = await getPosOrderMode();
        // テーブルレイアウトは連携モードに関係なく POS ネイティブの pos.table_layouts
        // から読む (設定画面「テーブルレイアウト」で作った見取り図)。まだ何も配置して
        // いない店舗向けに、失敗・0件時は空配列のまま (table-map-screen.tsx 側で
        // 既存のサンプル配置にフォールバックする)。
        const layoutPromise = getPosOrderTableLayout().catch(() => ({ items: [] as TableLayoutItemRecord[] }));
        if (menuSource === 'pos_native') {
          const [menuData, settingsData, layoutData] = await Promise.all([
            getPosOrderMenu(),
            getPosOrderSettings(),
            layoutPromise,
          ]);
          if (cancelled) return;
          setMenu(menuData.items);
          setSettings((prev) => ({ ...prev, ...settingsData }));
          setLayoutItems(layoutData.items);
        } else {
          const [menuData, settingsData, layoutData] = await Promise.all([
            getPosMenus(),
            getPosSettings(),
            layoutPromise,
          ]);
          if (cancelled) return;
          setMenu(menuData.map((m) => ({ ...m, category: m.category ?? '未分類' })));
          setSettings((prev) => ({ ...prev, ...settingsData }));
          setLayoutItems(layoutData.items);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof PosApiError || err instanceof PosOrderApiError
            ? err.message
            : 'メニュー・設定の取得に失敗しました。通信環境を確認してください。';
        setDataError(message);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadToken]);

  // メニュー取得後、最初のカテゴリを選択状態にする
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const vat = subtotal * (settings.vatRate / 100);
    const service = subtotal * (settings.serviceRate / 100);
    const couponDiscount = couponApplied ? Math.min(5, subtotal) : 0;
    const total = Math.max(0, subtotal + vat + service - couponDiscount);
    return { subtotal, vat, service, couponDiscount, total };
  }, [cart, couponApplied, settings.vatRate, settings.serviceRate]);

  function resetOrderState() {
    setCustomerLinked(false);
    setCouponApplied(false);
    setPaymentTab('cash');
    setCashUsdReceivedStr('');
    setCashKhrReceivedStr('');
    setChangeUsdStr('');
    setQrConfirmed(false);
    setCardConfirmed(false);
    setOptionModalItem(null);
    setOptionSelection({});
  }

  function selectTable(code: string) {
    setSelectedTable(code);
    setCart([]);
    setActiveCategory(categories[0] ?? '');
    resetOrderState();
    setScreen('order');
  }

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((l) => l.id === item.id);
      if (existing) return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: item.id, menuId: item.id, name: item.name, unitPrice: item.price, qty: 1, selectedOptions: [] }];
    });
  }

  function incLine(id: string) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)));
  }
  function decLine(id: string) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0));
  }

  function onAddItem(item: MenuItem) {
    if (item.optionGroups && item.optionGroups.length > 0) {
      setOptionModalItem(item);
      setOptionSelection({});
    } else {
      addToCart(item);
    }
  }

  function confirmOptionModal() {
    if (!optionModalItem) return;
    const groups = optionModalItem.optionGroups ?? [];
    if (!groups.every((g) => optionSelection[g.key])) return;

    const priceDeltaTotal = groups.reduce((sum, g) => {
      const choice = g.choices.find((c) => c.id === optionSelection[g.key]);
      return sum + (choice ? choice.priceDelta : 0);
    }, 0);
    const optionLabel = groups
      .map((g) => g.choices.find((c) => c.id === optionSelection[g.key])?.label ?? '')
      .join('・');
    const lineId = optionModalItem.id + ':' + groups.map((g) => optionSelection[g.key]).join(',');
    const unitPrice = optionModalItem.price + priceDeltaTotal;
    const selectedOptions = groups.map((g) => {
      const choice = g.choices.find((c) => c.id === optionSelection[g.key])!;
      return { groupKey: g.key, groupLabel: g.label, choiceId: choice.id, choiceLabel: choice.label, priceDelta: choice.priceDelta };
    });

    setCart((prev) => {
      const existing = prev.find((l) => l.id === lineId);
      if (existing) return prev.map((l) => (l.id === lineId ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...prev,
        {
          id: lineId,
          menuId: optionModalItem.id,
          name: `${optionModalItem.name}(${optionLabel})`,
          unitPrice,
          qty: 1,
          selectedOptions,
        },
      ];
    });
    setOptionModalItem(null);
    setOptionSelection({});
  }

  function completeOrder() {
    setScreen('receipt');
  }

  function newOrder() {
    setScreen('tablemap');
    setSelectedTable(null);
    setCart([]);
    resetOrderState();
  }

  if (dataLoading) {
    return (
      <div className="flex h-[800px] w-[1280px] flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <div className="text-sm">メニュー・設定を読み込み中…</div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="flex h-[800px] w-[1280px] flex-col items-center justify-center gap-4 bg-background px-10 text-center">
        <div className="text-sm font-semibold text-destructive">{dataError}</div>
        <button
          onClick={() => setLoadToken((t) => t + 1)}
          className="h-10 rounded-lg bg-primary px-5 text-[13.5px] font-bold text-primary-foreground"
        >
          再読み込み
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-[800px] w-[1280px] flex-col overflow-hidden bg-background">
      <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground">
            住
          </div>
          <div className="text-base font-bold tracking-tight">I&apos;mHungry POS</div>
        </div>
        <div className="flex items-center gap-3.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            オンライン
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-secondary text-xs font-semibold"
            >
              {me.display_name.slice(0, 2).toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <button
                  aria-label="close menu"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-56 rounded-xl border border-border bg-card py-1.5 shadow-lg">
                  <div className="border-b border-border px-3.5 py-2.5">
                    <div className="text-[13px] font-semibold">{me.display_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {{ owner: 'オーナー', manager: 'マネージャー', staff: 'スタッフ' }[me.role]}
                    </div>
                  </div>
                  <button
                    onClick={() => router.push('/pos/settings')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    設定
                  </button>
                  <button
                    onClick={() => router.push('/pos/table-layout')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    テーブルレイアウト
                  </button>
                  <button
                    onClick={() => router.push('/pos/register-closing')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    レジ締め
                  </button>
                  {me.authMode === 'pos_native' && (
                    <button
                      onClick={() => {
                        logoutPosStaff().finally(() => router.replace('/login'));
                      }}
                      className="block w-full border-t border-border px-3.5 py-2 text-left text-[12.5px] text-destructive hover:bg-secondary"
                    >
                      ログアウト
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {screen === 'tablemap' && (
        <TableMapScreen
          tableStatus={tableStatus}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onSelectTable={selectTable}
          layoutItems={layoutItems}
        />
      )}

      {screen === 'order' && (
        <OrderScreen
          selectedTable={selectedTable}
          menu={menu}
          categories={categories}
          activeCategory={activeCategory}
          onCategory={setActiveCategory}
          cart={cart}
          onAddItem={onAddItem}
          onInc={incLine}
          onDec={decLine}
          subtotal={totals.subtotal}
          taxService={totals.vat + totals.service}
          vatRate={settings.vatRate}
          serviceRate={settings.serviceRate}
          total={totals.total}
          onBackToTableMap={() => setScreen('tablemap')}
          onCheckout={() => cart.length > 0 && setScreen('checkout')}
        />
      )}

      {screen === 'checkout' && (
        <CheckoutScreen
          selectedTable={selectedTable}
          cart={cart}
          totals={totals}
          couponApplied={couponApplied}
          customerLinked={customerLinked}
          onLinkCustomer={() => setCustomerLinked(true)}
          onApplyCoupon={() => setCouponApplied(true)}
          paymentTab={paymentTab}
          onPaymentTab={setPaymentTab}
          cashUsdReceivedStr={cashUsdReceivedStr}
          cashKhrReceivedStr={cashKhrReceivedStr}
          onUsdReceivedChange={(v) => {
            setCashUsdReceivedStr(v);
            setChangeUsdStr('');
          }}
          onKhrReceivedChange={(v) => {
            setCashKhrReceivedStr(v);
            setChangeUsdStr('');
          }}
          changeUsdStr={changeUsdStr}
          onChangeUsdInc={() => setChangeUsdStr((v) => String((parseInt(v, 10) || 0) + 1))}
          onChangeUsdDec={() => setChangeUsdStr((v) => String(Math.max(0, (parseInt(v, 10) || 0) - 1)))}
          khrRate={settings.khrRate}
          qrConfirmed={qrConfirmed}
          onConfirmQr={() => setQrConfirmed(true)}
          cardConfirmed={cardConfirmed}
          onConfirmCard={() => setCardConfirmed(true)}
          onBackToOrder={() => setScreen('order')}
          onComplete={completeOrder}
        />
      )}

      {screen === 'receipt' && (
        <ReceiptScreen selectedTable={selectedTable} total={totals.total} onNewOrder={newOrder} />
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
