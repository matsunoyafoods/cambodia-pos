'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const USD_DENOMS = [100, 50, 20, 10, 5, 1];
const KHR_DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];

// システム合計はデモ値。本番は pos.orders / pos.payments から当日分を集計する
// (integration-spec.md 4.2 `POST /api/pos/register-closings` の system_total_* に相当)。
const SYSTEM_CASH_TOTAL = 420.0;
const SYSTEM_QR_TOTAL = 180.5;
const SYSTEM_CARD_TOTAL = 95.0;

export function RegisterClosingScreen({ khrRate }: { khrRate: number }) {
  const router = useRouter();
  const [usd, setUsd] = useState<Record<number, number>>(Object.fromEntries(USD_DENOMS.map((d) => [d, 0])));
  const [khr, setKhr] = useState<Record<number, number>>(Object.fromEntries(KHR_DENOMS.map((d) => [d, 0])));
  const [confirmed, setConfirmed] = useState(false);

  const usdSubtotal = USD_DENOMS.reduce((a, d) => a + d * usd[d], 0);
  const khrSubtotal = KHR_DENOMS.reduce((a, d) => a + d * khr[d], 0);
  const khrInUsd = khrSubtotal / khrRate;
  const countedTotal = usdSubtotal + khrInUsd;
  const diff = countedTotal - SYSTEM_CASH_TOTAL;
  const diffOk = Math.abs(diff) < 0.005;

  const salesTotal = SYSTEM_CASH_TOTAL + SYSTEM_QR_TOTAL + SYSTEM_CARD_TOTAL;

  function setDenom(kind: 'usd' | 'khr', d: number, qty: number) {
    const clamped = Math.max(0, qty);
    if (kind === 'usd') setUsd((prev) => ({ ...prev, [d]: clamped }));
    else setKhr((prev) => ({ ...prev, [d]: clamped }));
    setConfirmed(false);
  }

  return (
    <div className="flex h-[800px] w-[1280px] flex-col overflow-hidden bg-background">
      <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/pos')}
            className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-secondary"
          >
            ← 戻る
          </button>
          <div>
            <div className="text-base font-bold">レジ締め</div>
            <div className="text-xs text-muted-foreground">{new Date().toISOString().slice(0, 10)} ・ 夜の部</div>
          </div>
        </div>
        <button
          onClick={() => setConfirmed(true)}
          className={
            'h-10 rounded-lg px-4.5 text-[13.5px] font-bold ' +
            (confirmed ? 'bg-emerald-100 text-emerald-600' : 'bg-primary text-primary-foreground')
          }
        >
          {confirmed ? '確定しました ✓' : 'レジ締めを確定'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-[300px] flex-col gap-3.5 overflow-auto border-r border-border p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            システム合計 (POS記録)
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-between text-[13.5px]">
              <span>現金</span>
              <span className="font-semibold">${SYSTEM_CASH_TOTAL.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[13.5px]">
              <span>QR (ABA/KHQR)</span>
              <span className="font-semibold">${SYSTEM_QR_TOTAL.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[13.5px]">
              <span>カード</span>
              <span className="font-semibold">${SYSTEM_CARD_TOTAL.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-border pt-2.5 text-[15px] font-bold">
              <span>売上合計</span>
              <span>${salesTotal.toFixed(2)}</span>
            </div>
          </div>

          <div className={'mt-2.5 rounded-xl p-3.5 ' + (diffOk ? 'bg-emerald-50' : diff > 0 ? 'bg-sky-50' : 'bg-red-50')}>
            <div className="mb-1 text-xs text-muted-foreground">現金の過不足</div>
            <div
              className={
                'text-[22px] font-bold ' + (diffOk ? 'text-emerald-600' : diff > 0 ? 'text-sky-600' : 'text-destructive')
              }
            >
              {diff >= 0 ? '+$' : '-$'}
              {Math.abs(diff).toFixed(2)}
            </div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              実査 ${countedTotal.toFixed(2)} − システム現金 ${SYSTEM_CASH_TOTAL.toFixed(2)}
            </div>
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            硬貨は流通していないため、USD・KHRとも紙幣のみ対応。KHR→USD換算は参考レート（1USD={khrRate.toLocaleString()}riel、設定画面で編集可能）。
          </div>
        </div>

        <div className="flex flex-1 gap-6 overflow-auto p-5">
          <DenomColumn
            title="USD 紙幣"
            denoms={USD_DENOMS}
            values={usd}
            onChange={(d, v) => setDenom('usd', d, v)}
            fmtDenom={(d) => `$${d}`}
            fmtLine={(d, q) => `$${(d * q).toFixed(2)}`}
            subtotalLabel={`$${usdSubtotal.toFixed(2)}`}
          />
          <DenomColumn
            title="KHR 紙幣"
            denoms={KHR_DENOMS}
            values={khr}
            onChange={(d, v) => setDenom('khr', d, v)}
            fmtDenom={(d) => `${d.toLocaleString()}៛`}
            fmtLine={(d, q) => `${(d * q).toLocaleString()}៛`}
            subtotalLabel={`${khrSubtotal.toLocaleString()}៛ (≈$${khrInUsd.toFixed(2)})`}
          />
        </div>
      </div>
    </div>
  );
}

function DenomColumn({
  title,
  denoms,
  values,
  onChange,
  fmtDenom,
  fmtLine,
  subtotalLabel,
}: {
  title: string;
  denoms: number[];
  values: Record<number, number>;
  onChange: (d: number, v: number) => void;
  fmtDenom: (d: number) => string;
  fmtLine: (d: number, q: number) => string;
  subtotalLabel: string;
}) {
  return (
    <div className="flex-1">
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="flex flex-col gap-2">
        {denoms.map((d) => (
          <div key={d} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
            <div className="w-[70px] text-[13px] font-bold">{fmtDenom(d)}</div>
            <div className="h-px flex-1 bg-border" />
            <button
              onClick={() => onChange(d, values[d] - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
            >
              −
            </button>
            <input
              value={values[d]}
              onChange={(e) => onChange(d, parseInt(e.target.value, 10) || 0)}
              className="h-8 w-[52px] rounded-md border border-border text-center text-[13.5px]"
            />
            <button
              onClick={() => onChange(d, values[d] + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border"
            >
              ＋
            </button>
            <div className="w-[80px] text-right text-[12.5px] text-muted-foreground">{fmtLine(d, values[d])}</div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex justify-between border-t border-dashed border-border pt-2.5 text-[13.5px] font-bold">
        <span>小計</span>
        <span>{subtotalLabel}</span>
      </div>
    </div>
  );
}
