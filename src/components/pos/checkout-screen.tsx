'use client';

import { useEffect, useState } from 'react';
import type { DiscountType, PaymentLineInput, PaymentMethodConfig } from '@/lib/pos-types';
import type { OrderItemRecord } from '@/lib/pos-order-orders-client';
import { computeChange, money } from '@/lib/money';
import { useLanguage } from './language-context';

type Totals = {
  subtotal: number;
  vat: number;
  service: number;
  couponDiscount: number;
  orderDiscount: number;
  total: number;
};

// 会計画面の「合計」から直接かける急遽の値引き (%引き・$引き) の編集UI。CartLineRow の
// 値引きエディタと同じ操作感。顧客紐付け・クーポンとは独立の枠 (2026-08-31 追加)。
function OrderDiscountEditor({
  discount,
  amount,
  onSet,
}: {
  discount: { type: DiscountType; value: number } | null;
  amount: number;
  onSet: (discount: { type: DiscountType; value: number } | null) => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<DiscountType>(discount?.type ?? 'percent');
  const [value, setValue] = useState(discount ? String(discount.value) : '');

  function apply() {
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v <= 0) return;
    onSet({ type: mode, value: v });
    setEditing(false);
  }
  function clear() {
    onSet(null);
    setValue('');
    setEditing(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[12.5px]">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={'text-left font-semibold ' + (discount ? 'text-brand' : 'text-muted-foreground underline decoration-dotted')}
        >
          {discount
            ? t(
                discount.type === 'percent' ? 'checkout.discountAppliedPercent' : 'checkout.discountAppliedFixed',
                { value: discount.type === 'percent' ? discount.value : discount.value.toFixed(2) },
              )
            : t('checkout.addDiscount')}
        </button>
        {discount && <span className="text-brand">-${money(amount)}</span>}
      </div>
      {editing && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-dashed border-border p-1.5">
          <div className="flex rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setMode('percent')}
              className={
                'h-6 rounded px-2 text-[11px] font-semibold ' +
                (mode === 'percent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
              }
            >
              {t('discount.percentMode')}
            </button>
            <button
              type="button"
              onClick={() => setMode('fixed')}
              className={
                'h-6 rounded px-2 text-[11px] font-semibold ' +
                (mode === 'fixed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
              }
            >
              {t('discount.fixedMode')}
            </button>
          </div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                apply();
              }
            }}
            inputMode="decimal"
            placeholder={mode === 'percent' ? '10' : '5.00'}
            className="h-7 w-16 rounded-md border border-border px-2 text-[12px]"
          />
          <button
            type="button"
            onClick={apply}
            disabled={!value.trim()}
            className="h-7 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t('discount.apply')}
          </button>
          {discount && (
            <button
              type="button"
              onClick={clear}
              className="h-7 rounded-md border border-border px-2.5 text-[11px] font-semibold text-destructive"
            >
              {t('discount.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CheckoutScreen({
  selectedTable,
  confirmedItems,
  totals,
  vatRate,
  serviceRate,
  vatInclusive,
  couponApplied,
  customerLinked,
  onLinkCustomer,
  onApplyCoupon,
  orderDiscount,
  onSetOrderDiscount,
  paymentLines,
  onAddPaymentLine,
  onRemovePaymentLine,
  paymentMethods,
  khrRate,
  onBackToOrder,
  onComplete,
  completing,
  completeError,
}: {
  selectedTable: string | null;
  confirmedItems: OrderItemRecord[];
  totals: Totals;
  vatRate: number;
  serviceRate: number;
  vatInclusive: boolean;
  couponApplied: boolean;
  customerLinked: boolean;
  onLinkCustomer: () => void;
  onApplyCoupon: () => void;
  orderDiscount: { type: DiscountType; value: number } | null;
  onSetOrderDiscount: (discount: { type: DiscountType; value: number } | null) => void;
  paymentLines: PaymentLineInput[];
  onAddPaymentLine: (line: Omit<PaymentLineInput, 'id'>) => void;
  onRemovePaymentLine: (id: string) => void;
  /** 有効な決済方法一覧 (店舗が設定画面で自由に追加できる。2026-08-31 追加) */
  paymentMethods: PaymentMethodConfig[];
  khrRate: number;
  onBackToOrder: () => void;
  onComplete: () => void;
  completing: boolean;
  completeError: string | null;
}) {
  const { t } = useLanguage();
  // 分割払い・割り勘: 「残り」= 合計 - すでに追加された支払いラインの合計。0 (端数誤差込み) に
  // なったら会計を完了できる (2026-08-31 多分割対応で全面書き換え)。
  const paidSoFar = paymentLines.reduce((s, l) => s + l.amount, 0);
  const remaining = Math.max(0, totals.total - paidSoFar);
  const remainingSettled = remaining <= 0.005;

  // 未提供の商品があるうちは会計できないようにする (2026-09-04 追加。Tom「会計についてですが
  // 提供済みになっていないと会計ができないようにしてください」)。判定はレジ/キッチン/ドリンク
  // モニターと同じ item.kitchen_done_at (null なら未提供)。
  const unservedCount = confirmedItems.filter((item) => !item.kitchen_done_at).length;
  const allServed = unservedCount === 0;

  // 決済方法は店舗が自由に追加できるため (2026-08-31 変更)、固定の 'cash'|'qr'|'card' ではなく
  // 選択中の決済方法IDを持つ。paymentMethods が非同期で届く/変わった時に選択が消えていたら
  // 先頭 (通常は現金) を選び直す。
  const [selectedMethodId, setSelectedMethodId] = useState<string>('');
  useEffect(() => {
    if (paymentMethods.length === 0) return;
    if (!paymentMethods.some((m) => m.id === selectedMethodId)) {
      setSelectedMethodId(paymentMethods[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethods]);
  const selectedMethod = paymentMethods.find((m) => m.id === selectedMethodId) ?? null;
  const isCashMethod = selectedMethod?.isCash ?? false;

  const [amountStr, setAmountStr] = useState(remaining.toFixed(2));
  const [amountTouched, setAmountTouched] = useState(false);
  const [cashUsdReceivedStr, setCashUsdReceivedStr] = useState('');
  const [cashKhrReceivedStr, setCashKhrReceivedStr] = useState('');
  const [changeUsdStr, setChangeUsdStr] = useState('');

  // 残りが変わった (ライン追加・削除) のに合わせて、次のラインの入力額を「残り」に自動で
  // 合わせ直す (ユーザーが手で編集していない限り)。会計を完了したら (remaining===0) は 0 のまま。
  useEffect(() => {
    if (!amountTouched) {
      setAmountStr(remaining > 0 ? remaining.toFixed(2) : '0.00');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const lineAmount = Math.min(Math.max(parseFloat(amountStr) || 0, 0), remaining > 0 ? remaining : parseFloat(amountStr) || 0);

  const usdReceived = parseFloat(cashUsdReceivedStr) || 0;
  const khrReceived = parseInt(cashKhrReceivedStr, 10) || 0;
  const change = computeChange({
    total: lineAmount,
    usdReceived,
    khrReceived,
    khrRate,
    changeUsdOverride: changeUsdStr === '' ? undefined : parseInt(changeUsdStr, 10) || 0,
  });

  const usdPresets = Array.from(
    new Set([Math.floor(lineAmount), Math.ceil(lineAmount), Math.ceil(lineAmount / 5) * 5]),
  ).filter((n) => n >= 0);
  const khrPresets = [0, 1000, 2000, 5000];

  function resetLineForm() {
    setAmountStr(remaining > 0 ? remaining.toFixed(2) : '0.00');
    setAmountTouched(false);
    setCashUsdReceivedStr('');
    setCashKhrReceivedStr('');
    setChangeUsdStr('');
  }

  function addLine() {
    if (lineAmount <= 0 || !selectedMethod) return;
    if (isCashMethod) {
      onAddPaymentLine({
        method: selectedMethod.name,
        amount: lineAmount,
        cashReceivedUsd: usdReceived,
        cashReceivedKhr: khrReceived,
        changeUsd: change.changeUsd,
        changeKhr: change.changeKhr,
      });
    } else {
      onAddPaymentLine({ method: selectedMethod.name, amount: lineAmount });
    }
    resetLineForm();
  }

  const canAddCashLine = lineAmount > 0 && change.totalReceivedUsdEquiv >= lineAmount - 0.005;
  const canAddLine = Boolean(selectedMethod) && (isCashMethod ? canAddCashLine : lineAmount > 0);

  const splitPresets = [2, 3, 4, 5, 6];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex w-[320px] flex-col overflow-hidden border-r border-border">
        <div className="flex items-center gap-2.5 border-b border-border px-4.5 py-3.5">
          <button
            onClick={onBackToOrder}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card"
          >
            ←
          </button>
          <div className="text-sm font-bold">{t('checkout.title', { table: selectedTable ?? '' })}</div>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-auto px-4.5 py-3.5">
          {confirmedItems.map((line) => (
            <div key={line.id} className="flex justify-between text-[13px]">
              <span className="flex items-center gap-1.5">
                {line.menu_name} × {line.qty}
                {!line.kitchen_done_at && (
                  <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                    {t('checkout.unservedBadge')}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">${money(line.line_total)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border px-4.5 py-3.5">
          <div className="flex justify-between text-[12.5px]">
            <span>{t('totals.subtotal')}</span>
            <span>${money(totals.subtotal)}</span>
          </div>
          {vatRate > 0 && (
            <div className="flex justify-between text-[12.5px]">
              <span>
                {t('totals.vat', { rate: vatRate })}
                {vatInclusive ? t('totals.vatInclusive') : ''}
              </span>
              <span>${money(totals.vat)}</span>
            </div>
          )}
          {serviceRate > 0 && (
            <div className="flex justify-between text-[12.5px]">
              <span>{t('totals.service', { rate: serviceRate })}</span>
              <span>${money(totals.service)}</span>
            </div>
          )}
          {couponApplied && (
            <div className="flex justify-between text-[12.5px] text-brand">
              <span>{t('checkout.couponDiscount')}</span>
              <span>-${money(totals.couponDiscount)}</span>
            </div>
          )}
          <div className="pt-1">
            <OrderDiscountEditor discount={orderDiscount} amount={totals.orderDiscount} onSet={onSetOrderDiscount} />
          </div>
          <div className="mt-1 flex justify-between border-t border-dashed border-border pt-2 text-[17px] font-bold">
            <span>{t('totals.total')}</span>
            <span>${money(totals.total)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
        <div className="rounded-xl border border-border p-3.5">
          {customerLinked ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-[13px] font-bold text-brand">
                  SD
                </div>
                <div>
                  <div className="text-[13.5px] font-bold">{t('checkout.demoCustomerName')}</div>
                  <div className="text-[11.5px] text-muted-foreground">{t('checkout.demoStampInfo')}</div>
                </div>
              </div>
              {couponApplied ? (
                <div className="text-xs font-semibold text-brand">{t('checkout.couponApplied')}</div>
              ) : (
                <button
                  onClick={onApplyCoupon}
                  className="h-8 rounded-lg border border-brand px-3 text-xs font-semibold text-brand"
                >
                  {t('checkout.applyCoupon5')}
                </button>
              )}
            </div>
          ) : (
            <button onClick={onLinkCustomer} className="flex w-full items-center gap-2.5 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">▦</div>
              <div>
                <div className="text-[13.5px] font-semibold">{t('checkout.linkCustomerPrompt')}</div>
                <div className="text-[11.5px] text-muted-foreground">{t('checkout.linkCustomerNote')}</div>
              </div>
            </button>
          )}
        </div>

        {/* 分割払い・割り勘: 追加済みの支払いラインの一覧 + 残額 (2026-08-31 追加) */}
        <div className="rounded-xl border border-border p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-muted-foreground">{t('checkout.paymentBreakdown')}</div>
            <div className={'text-[12.5px] font-bold ' + (remainingSettled ? 'text-emerald-600' : 'text-destructive')}>
              {t('checkout.remaining')} ${money(remaining)}
            </div>
          </div>
          {paymentLines.length === 0 ? (
            <div className="py-1 text-[12px] text-muted-foreground">{t('checkout.noPaymentsYet')}</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {paymentLines.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-[12.5px]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{l.method}</span>
                    <span>${money(l.amount)}</span>
                    {l.cashReceivedUsd != null && (
                      <span className="text-[11px] text-muted-foreground">
                        ({t('checkout.received')} ${money(l.cashReceivedUsd)}
                        {l.cashReceivedKhr ? ` + ${l.cashReceivedKhr.toLocaleString()}៛` : ''} / {t('checkout.change')} ${(l.changeUsd ?? 0).toFixed(0)}+{(l.changeKhr ?? 0).toLocaleString()}៛)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onRemovePaymentLine(l.id)}
                    className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
                  >
                    {t('discount.deleteTitle')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!remainingSettled && paymentMethods.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4.5 text-[12.5px] text-muted-foreground">
            {t('checkout.noPaymentMethods')}
          </div>
        )}

        {!remainingSettled && paymentMethods.length > 0 && (
          <div className="flex flex-col gap-3.5 rounded-xl border border-border p-4.5">
            <div className="flex items-center justify-between">
              <div className="flex w-fit flex-wrap gap-1.5 rounded-lg bg-secondary p-1">
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMethodId(m.id)}
                    className={
                      'h-8 rounded-md px-4.5 text-[12.5px] font-semibold ' +
                      (selectedMethodId === m.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
                    }
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              {/* 割り勘: 残額を人数で均等割りして、この支払いラインの金額に自動入力する */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">{t('checkout.splitEvenly')}</span>
                {splitPresets.map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setAmountStr((remaining / n).toFixed(2));
                      setAmountTouched(true);
                    }}
                    className="h-7 rounded-md border border-border px-2 text-[11px]"
                  >
                    {t('checkout.peopleCount', { n })}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">{t('checkout.lineAmountLabel')}</div>
              <input
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  setAmountTouched(true);
                }}
                inputMode="decimal"
                className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px]"
              />
            </div>

            {isCashMethod && (
              <>
                <div>
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">
                    {t('checkout.cashReceivedLabel')}
                  </div>
                  <div className="flex gap-3.5">
                    <div className="flex-1">
                      <div className="mb-1 text-[11px] text-muted-foreground">USD</div>
                      <input
                        value={cashUsdReceivedStr}
                        onChange={(e) => setCashUsdReceivedStr(e.target.value)}
                        inputMode="decimal"
                        className="h-10 w-full rounded-lg border border-border px-3 text-[13.5px]"
                      />
                      <div className="mt-1.5 flex gap-1.5">
                        {usdPresets.map((n) => (
                          <button
                            key={n}
                            onClick={() => setCashUsdReceivedStr(String(n))}
                            className="h-7 rounded-md border border-border px-2 text-[11px]"
                          >
                            {n.toFixed(2)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="mb-1 text-[11px] text-muted-foreground">KHR</div>
                      <input
                        value={cashKhrReceivedStr}
                        onChange={(e) => setCashKhrReceivedStr(e.target.value)}
                        inputMode="numeric"
                        className="h-10 w-full rounded-lg border border-border px-3 text-[13.5px]"
                      />
                      <div className="mt-1.5 flex gap-1.5">
                        {khrPresets.map((n) => (
                          <button
                            key={n}
                            onClick={() => setCashKhrReceivedStr(String(n))}
                            className="h-7 rounded-md border border-border px-2 text-[11px]"
                          >
                            {n === 0 ? t('checkout.none') : n.toLocaleString() + '៛'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11.5px] text-muted-foreground">
                    {t('checkout.totalReceivedApprox', { amount: `$${money(change.totalReceivedUsdEquiv)}` })}
                  </div>
                </div>

                <div
                  className={
                    'flex items-center justify-between rounded-lg p-3 ' + (change.ok ? 'bg-emerald-50' : 'bg-secondary')
                  }
                >
                  <div>
                    <div className="text-xs text-muted-foreground">{t('checkout.change')}</div>
                    <div className={'text-lg font-bold ' + (change.ok ? 'text-emerald-600' : 'text-destructive')}>
                      ${change.changeUsd.toFixed(0)} + {change.changeKhr.toLocaleString()}៛
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setChangeUsdStr(String(Math.max(0, change.changeUsd - 1)))}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
                    >
                      −
                    </button>
                    <div className="w-6 text-center text-sm font-semibold">USD</div>
                    <button
                      onClick={() => setChangeUsdStr(String(Math.min(change.maxChangeUsd, change.changeUsd + 1)))}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
                    >
                      ＋
                    </button>
                  </div>
                </div>
              </>
            )}

            {!isCashMethod && selectedMethod && (
              <div className="text-[13px] text-muted-foreground">
                {t('checkout.nonCashInstruction', { method: selectedMethod.name, amount: `$${money(lineAmount)}` })}
              </div>
            )}

            <button
              onClick={addLine}
              disabled={!canAddLine}
              className={
                'h-11 rounded-lg text-sm font-bold ' +
                (canAddLine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')
              }
            >
              {t('checkout.addPaymentLine')}
            </button>
          </div>
        )}

        {!allServed && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-[12.5px] font-semibold text-destructive">
            {t('checkout.unservedWarning', { count: unservedCount })}
          </div>
        )}

        {completeError && <div className="text-[12px] text-destructive">{completeError}</div>}
        <button
          onClick={onComplete}
          disabled={completing || !remainingSettled || !allServed}
          className={
            'mt-auto h-[54px] rounded-xl text-[15px] font-bold ' +
            (remainingSettled && allServed && !completing ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')
          }
        >
          {completing ? t('common.processing') : t('checkout.completeButton')}
        </button>
      </div>
    </div>
  );
}
