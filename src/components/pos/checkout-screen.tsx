'use client';

import type { PaymentMethod } from '@/lib/pos-types';
import type { OrderItemRecord } from '@/lib/pos-order-orders-client';
import { computeChange, money } from '@/lib/money';

type Totals = { subtotal: number; vat: number; service: number; couponDiscount: number; total: number };

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
  paymentTab,
  onPaymentTab,
  cashUsdReceivedStr,
  cashKhrReceivedStr,
  onUsdReceivedChange,
  onKhrReceivedChange,
  changeUsdStr,
  onChangeUsdInc,
  onChangeUsdDec,
  khrRate,
  qrConfirmed,
  onConfirmQr,
  cardConfirmed,
  onConfirmCard,
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
  paymentTab: PaymentMethod;
  onPaymentTab: (t: PaymentMethod) => void;
  cashUsdReceivedStr: string;
  cashKhrReceivedStr: string;
  onUsdReceivedChange: (v: string) => void;
  onKhrReceivedChange: (v: string) => void;
  changeUsdStr: string;
  onChangeUsdInc: () => void;
  onChangeUsdDec: () => void;
  khrRate: number;
  qrConfirmed: boolean;
  onConfirmQr: () => void;
  cardConfirmed: boolean;
  onConfirmCard: () => void;
  onBackToOrder: () => void;
  onComplete: () => void;
  completing: boolean;
  completeError: string | null;
}) {
  const usdReceived = parseFloat(cashUsdReceivedStr) || 0;
  const khrReceived = parseInt(cashKhrReceivedStr, 10) || 0;
  const change = computeChange({
    total: totals.total,
    usdReceived,
    khrReceived,
    khrRate,
    changeUsdOverride: changeUsdStr === '' ? undefined : parseInt(changeUsdStr, 10) || 0,
  });

  const usdPresets = Array.from(
    new Set([Math.floor(totals.total), Math.ceil(totals.total), Math.ceil(totals.total / 5) * 5]),
  ).filter((n) => n >= 0);
  const khrPresets = [0, 1000, 2000, 5000];

  const canComplete =
    !completing &&
    ((paymentTab === 'cash' && change.ok) ||
      (paymentTab === 'qr' && qrConfirmed) ||
      (paymentTab === 'card' && cardConfirmed));

  const tabs: { key: PaymentMethod; label: string }[] = [
    { key: 'cash', label: '現金' },
    { key: 'qr', label: 'QR (ABA/KHQR)' },
    { key: 'card', label: 'カード' },
  ];

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
          <div className="text-sm font-bold">テーブル {selectedTable} の会計</div>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-auto px-4.5 py-3.5">
          {confirmedItems.map((line) => (
            <div key={line.id} className="flex justify-between text-[13px]">
              <span>
                {line.menu_name} × {line.qty}
              </span>
              <span className="text-muted-foreground">${money(line.line_total)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border px-4.5 py-3.5">
          <div className="flex justify-between text-[12.5px]">
            <span>小計</span>
            <span>${money(totals.subtotal)}</span>
          </div>
          {vatRate > 0 && (
            <div className="flex justify-between text-[12.5px]">
              <span>VAT {vatRate}%{vatInclusive ? ' (税込み)' : ''}</span>
              <span>${money(totals.vat)}</span>
            </div>
          )}
          {serviceRate > 0 && (
            <div className="flex justify-between text-[12.5px]">
              <span>サービス料 {serviceRate}%</span>
              <span>${money(totals.service)}</span>
            </div>
          )}
          {couponApplied && (
            <div className="flex justify-between text-[12.5px] text-brand">
              <span>クーポン割引</span>
              <span>-${money(totals.couponDiscount)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-dashed border-border pt-2 text-[17px] font-bold">
            <span>合計</span>
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
                  <div className="text-[13.5px] font-bold">Sok Dara 様</div>
                  <div className="text-[11.5px] text-muted-foreground">スタンプ 12個保有 ・ クーポン1枚あり</div>
                </div>
              </div>
              {couponApplied ? (
                <div className="text-xs font-semibold text-brand">クーポン適用済み ✓</div>
              ) : (
                <button
                  onClick={onApplyCoupon}
                  className="h-8 rounded-lg border border-brand px-3 text-xs font-semibold text-brand"
                >
                  $5クーポンを適用
                </button>
              )}
            </div>
          ) : (
            <button onClick={onLinkCustomer} className="flex w-full items-center gap-2.5 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">▦</div>
              <div>
                <div className="text-[13.5px] font-semibold">Telegram QRをスキャンして顧客紐付け</div>
                <div className="text-[11.5px] text-muted-foreground">スタンプ自動付与・クーポン適用に必要です</div>
              </div>
            </button>
          )}
        </div>

        <div className="flex w-fit gap-1.5 rounded-lg bg-secondary p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onPaymentTab(t.key)}
              className={
                'h-8 rounded-md px-4.5 text-[12.5px] font-semibold ' +
                (paymentTab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {paymentTab === 'cash' && (
          <div className="flex flex-col gap-3.5 rounded-xl border border-border p-4.5">
            <div>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">
                お預かり金額（ドル・リエル混在可）
              </div>
              <div className="flex gap-3.5">
                <div className="flex-1">
                  <div className="mb-1 text-[11px] text-muted-foreground">USD</div>
                  <input
                    value={cashUsdReceivedStr}
                    onChange={(e) => onUsdReceivedChange(e.target.value)}
                    inputMode="decimal"
                    className="h-10 w-full rounded-lg border border-border px-3 text-[13.5px]"
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    {usdPresets.map((n) => (
                      <button
                        key={n}
                        onClick={() => onUsdReceivedChange(String(n))}
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
                    onChange={(e) => onKhrReceivedChange(e.target.value)}
                    inputMode="numeric"
                    className="h-10 w-full rounded-lg border border-border px-3 text-[13.5px]"
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    {khrPresets.map((n) => (
                      <button
                        key={n}
                        onClick={() => onKhrReceivedChange(String(n))}
                        className="h-7 rounded-md border border-border px-2 text-[11px]"
                      >
                        {n === 0 ? 'なし' : n.toLocaleString() + '៛'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11.5px] text-muted-foreground">
                合計受取額 ≈ ${money(change.totalReceivedUsdEquiv)}
              </div>
            </div>

            <div
              className={
                'flex items-center justify-between rounded-lg p-3 ' + (change.ok ? 'bg-emerald-50' : 'bg-secondary')
              }
            >
              <div>
                <div className="text-xs text-muted-foreground">お釣り</div>
                <div className={'text-lg font-bold ' + (change.ok ? 'text-emerald-600' : 'text-destructive')}>
                  ${change.changeUsd.toFixed(0)} + {change.changeKhr.toLocaleString()}៛
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onChangeUsdDec}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
                >
                  −
                </button>
                <div className="w-6 text-center text-sm font-semibold">USD</div>
                <button
                  onClick={onChangeUsdInc}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
                >
                  ＋
                </button>
              </div>
            </div>
          </div>
        )}

        {paymentTab === 'qr' && (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border p-6">
            <div className="grid h-40 w-40 grid-cols-6 grid-rows-6 gap-0.5 bg-card p-2">
              {Array.from({ length: 36 }).map((_, i) => (
                <div
                  key={i}
                  className={(i * 7 + Math.floor(i / 6) * 3) % 5 === 0 ? 'bg-primary' : 'bg-transparent'}
                />
              ))}
            </div>
            <button
              onClick={onConfirmQr}
              className={
                'h-11 w-full rounded-lg text-sm font-bold ' +
                (qrConfirmed ? 'bg-emerald-100 text-emerald-700' : 'bg-primary text-primary-foreground')
              }
            >
              {qrConfirmed ? '支払い完了を確認しました ✓' : '支払い完了を確認'}
            </button>
          </div>
        )}

        {paymentTab === 'card' && (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border p-6">
            <div className="text-[13px] text-muted-foreground">
              外部の専用カードリーダーで決済後、下のボタンで記録してください
            </div>
            <button
              onClick={onConfirmCard}
              className={
                'h-11 w-full rounded-lg text-sm font-bold ' +
                (cardConfirmed ? 'bg-emerald-100 text-emerald-700' : 'bg-primary text-primary-foreground')
              }
            >
              {cardConfirmed ? 'カード決済済みとして記録しました ✓' : 'カード決済済みとして記録'}
            </button>
          </div>
        )}

        {completeError && <div className="text-[12px] text-destructive">{completeError}</div>}
        <button
          onClick={onComplete}
          disabled={!canComplete}
          className={
            'mt-auto h-[54px] rounded-xl text-[15px] font-bold ' +
            (canComplete ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')
          }
        >
          {completing ? '処理中…' : '会計を完了する'}
        </button>
      </div>
    </div>
  );
}
