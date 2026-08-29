'use client';

import { useMemo, useState } from 'react';
import type { CartLine, MenuItem, PaymentMethod, TableStatus } from '@/lib/pos-types';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';
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
  const settings = DEFAULT_SETTINGS; // TODO: GET /api/pos/settings に差し替え

  const [screen, setScreen] = useState<Screen>('tablemap');
  const [tableStatus] = useState<Record<string, TableStatus>>({ BC3: 'occupied', C2: 'billing' });
  const [statusFilter, setStatusFilter] = useState<'all' | TableStatus>('all');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('メイン');
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
    setActiveCategory('メイン');
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
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-secondary text-xs font-semibold">
            TM
          </div>
        </div>
      </div>

      {screen === 'tablemap' && (
        <TableMapScreen
          tableStatus={tableStatus}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onSelectTable={selectTable}
        />
      )}

      {screen === 'order' && (
        <OrderScreen
          selectedTable={selectedTable}
          activeCategory={activeCategory}
          onCategory={setActiveCategory}
          cart={cart}
          onAddItem={onAddItem}
          onInc={incLine}
          onDec={decLine}
          subtotal={totals.subtotal}
          taxService={totals.vat + totals.service}
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
