'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  confirmRegisterClosing,
  deleteRegisterClosing,
  getRegisterClosingStatus,
  PosRegisterClosingApiError,
  type RegisterClosingRecord,
  type RegisterClosingStatus,
} from '@/lib/register-closing-client';
import { getPosOrderSettings } from '@/lib/pos-order-client';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// レジ締め (2026-09-02 実データ連携)。
// 従来はシステム合計・現金過不足のすべてが固定のデモ値で、「レジ締めを確定」ボタンも DB には
// 何も書き込んでいなかった (pos.register_closings は常に0件だった)。Tom「レジ締めの時の現金売上が
// 貯まるようにして」への対応で、実際の注文・支払いデータから当日分を集計し、確定した記録を
// pos.register_closings に保存するようにした。確定した現金売上 (system_cash_total) が、
// 経費画面の「現金残高」(/pos/expenses) に積み上がっていく。

const USD_DENOMS = [100, 50, 20, 10, 5, 1];
const KHR_DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function PosNativeOnlyNotice() {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
      <p className="mb-2 font-bold">{t('common.posNativeOnlyTitle')}</p>
      <p className="mb-3 text-[13px] leading-relaxed">{t('common.posNativeOnlyBody')}</p>
      <a href="/login" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md">
        {t('common.posNativeOnlyLoginLink')}
      </a>
    </div>
  );
}

export function RegisterClosingScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <RegisterClosingScreenInner />
    </LanguageProvider>
  );
}

function RegisterClosingScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = me.role === 'owner' || me.role === 'manager';

  const [khrRate, setKhrRate] = useState(DEFAULT_SETTINGS.khrRate);
  useEffect(() => {
    if (!isPosNative) return;
    getPosOrderSettings()
      .then((s) => setKhrRate(s.khrRate))
      .catch(() => {
        /* 取得失敗時はデフォルトレートのまま (概算表示にはなるが締め作業自体はできる) */
      });
  }, [isPosNative]);

  const [date, setDate] = useState(todayIso());
  const [status, setStatus] = useState<RegisterClosingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    if (!isPosNative) return;
    setLoading(true);
    setLoadError(null);
    getRegisterClosingStatus(date)
      .then(setStatus)
      .catch((err) => setLoadError(err instanceof PosRegisterClosingApiError ? err.message : t('registerClosing.loadError')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isPosNative]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t('registerClosing.title')}</div>
        {isPosNative && (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="ml-2 h-9 rounded-lg border border-border px-2.5 text-[13px]"
          />
        )}
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-5">
          {!isPosNative ? (
            <PosNativeOnlyNotice />
          ) : loading ? (
            <div className="text-[13px] text-muted-foreground">{t('common.loadingEllipsis')}</div>
          ) : loadError ? (
            <div className="text-[13px] text-destructive">{loadError}</div>
          ) : status?.confirmed ? (
            <ConfirmedClosingView closing={status.closing} canManage={canManage} onReopen={load} />
          ) : status ? (
            <ClosingForm date={date} systemCashTotal={status.systemCashTotal} systemTotalsByMethod={status.systemTotalsByMethod} khrRate={khrRate} onConfirmed={load} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConfirmedClosingView({ closing, canManage, onReopen }: { closing: RegisterClosingRecord; canManage: boolean; onReopen: () => void }) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diffOk = Math.abs(closing.differenceUsd) < 0.005;

  async function handleReopen() {
    if (!confirm(t('registerClosing.reopenConfirm', { date: closing.date }))) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRegisterClosing(closing.id);
      onReopen();
    } catch (err) {
      setError(err instanceof PosRegisterClosingApiError ? err.message : t('registerClosing.deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[14px] font-bold text-emerald-800">{t('registerClosing.confirmedTitle', { date: closing.date })}</div>
        {canManage && (
          <button
            onClick={handleReopen}
            disabled={deleting}
            className="h-9 rounded-lg border border-destructive px-3.5 text-[12px] font-semibold text-destructive disabled:opacity-50"
          >
            {deleting ? t('registerClosing.deleting') : t('registerClosing.deleteAndRedo')}
          </button>
        )}
      </div>
      {error && <div className="mb-2 text-[12.5px] text-destructive">{error}</div>}
      <div className="grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-4">
        <Stat label={t('registerClosing.systemCashLabel')} value={`$${closing.systemCashTotal.toFixed(2)}`} />
        <Stat label={t('registerClosing.countedTotalLabel')} value={`$${closing.countedTotalUsd.toFixed(2)}`} />
        <Stat
          label={t('registerClosing.differenceLabel')}
          value={`${closing.differenceUsd >= 0 ? '+' : '-'}$${Math.abs(closing.differenceUsd).toFixed(2)}`}
          tone={diffOk ? 'ok' : closing.differenceUsd > 0 ? 'info' : 'bad'}
        />
        <Stat label={t('registerClosing.confirmedByLabel')} value={closing.confirmedByName ?? '-'} />
      </div>
      {Object.keys(closing.systemTotalsByMethod).length > 0 && (
        <div className="mt-3 text-[12px] text-muted-foreground">
          {t('registerClosing.byMethodLabel')}: {Object.entries(closing.systemTotalsByMethod).map(([m, v]) => `${m} $${v.toFixed(2)}`).join(' ・ ')}
        </div>
      )}
      <div className="mt-3 text-[11.5px] text-muted-foreground">
        {t('registerClosing.confirmedAtLabel')}: {new Date(closing.confirmedAt).toLocaleString('ja-JP')}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'info' | 'bad' }) {
  const color = tone === 'ok' ? 'text-emerald-600' : tone === 'bad' ? 'text-destructive' : tone === 'info' ? 'text-sky-600' : 'text-foreground';
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={'text-[15px] font-bold ' + color}>{value}</div>
    </div>
  );
}

function ClosingForm({
  date,
  systemCashTotal,
  systemTotalsByMethod,
  khrRate,
  onConfirmed,
}: {
  date: string;
  systemCashTotal: number;
  systemTotalsByMethod: Record<string, number>;
  khrRate: number;
  onConfirmed: () => void;
}) {
  const { t } = useLanguage();
  const [usd, setUsd] = useState<Record<number, number>>(Object.fromEntries(USD_DENOMS.map((d) => [d, 0])));
  const [khr, setKhr] = useState<Record<number, number>>(Object.fromEntries(KHR_DENOMS.map((d) => [d, 0])));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 日付が変わったら (前の日の入力が残らないよう) カウントをリセットする。
  useEffect(() => {
    setUsd(Object.fromEntries(USD_DENOMS.map((d) => [d, 0])));
    setKhr(Object.fromEntries(KHR_DENOMS.map((d) => [d, 0])));
    setError(null);
  }, [date]);

  const usdSubtotal = USD_DENOMS.reduce((a, d) => a + d * usd[d], 0);
  const khrSubtotal = KHR_DENOMS.reduce((a, d) => a + d * khr[d], 0);
  const khrInUsd = khrSubtotal / khrRate;
  const countedTotal = usdSubtotal + khrInUsd;
  const diff = countedTotal - systemCashTotal;
  const diffOk = Math.abs(diff) < 0.005;

  const salesTotal = useMemo(() => Object.values(systemTotalsByMethod).reduce((a, b) => a + b, 0), [systemTotalsByMethod]);

  function setDenom(kind: 'usd' | 'khr', d: number, qty: number) {
    const clamped = Math.max(0, qty);
    if (kind === 'usd') setUsd((prev) => ({ ...prev, [d]: clamped }));
    else setKhr((prev) => ({ ...prev, [d]: clamped }));
  }

  async function confirm_() {
    setSubmitting(true);
    setError(null);
    try {
      await confirmRegisterClosing({ date, countedUsdBills: usd, countedKhrBills: khr });
      onConfirmed();
    } catch (err) {
      setError(err instanceof PosRegisterClosingApiError ? err.message : t('registerClosing.confirmError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 sm:flex-row">
      <div className="flex w-full flex-col gap-3.5 sm:w-[280px]">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('registerClosing.systemTotalLabel', { date })}</div>
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5">
          {Object.entries(systemTotalsByMethod).map(([method, amount]) => (
            <div key={method} className="flex justify-between text-[13.5px]">
              <span>{method}</span>
              <span className="font-semibold">${amount.toFixed(2)}</span>
            </div>
          ))}
          {Object.keys(systemTotalsByMethod).length === 0 && <div className="text-[12.5px] text-muted-foreground">{t('registerClosing.noRecordsToday')}</div>}
          <div className="flex justify-between border-t border-dashed border-border pt-2.5 text-[15px] font-bold">
            <span>{t('registerClosing.salesTotalLabel')}</span>
            <span>${salesTotal.toFixed(2)}</span>
          </div>
        </div>

        <div className={'rounded-xl p-3.5 ' + (diffOk ? 'bg-emerald-50' : diff > 0 ? 'bg-sky-50' : 'bg-red-50')}>
          <div className="mb-1 text-xs text-muted-foreground">{t('registerClosing.cashDiffLabel')}</div>
          <div className={'text-[22px] font-bold ' + (diffOk ? 'text-emerald-600' : diff > 0 ? 'text-sky-600' : 'text-destructive')}>
            {diff >= 0 ? '+$' : '-$'}
            {Math.abs(diff).toFixed(2)}
          </div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">
            {t('registerClosing.countedMinusSystem', { counted: countedTotal.toFixed(2), system: systemCashTotal.toFixed(2) })}
          </div>
        </div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          {t('registerClosing.billsNote', { rate: khrRate.toLocaleString() })} {t('registerClosing.confirmEffectNote', { total: systemCashTotal.toFixed(2) })}
        </div>
        {error && <div className="text-[12.5px] text-destructive">{error}</div>}
        <button
          onClick={confirm_}
          disabled={submitting}
          className="h-11 rounded-lg bg-primary px-4.5 text-[13.5px] font-bold text-primary-foreground disabled:opacity-60"
        >
          {submitting ? t('registerClosing.confirming') : t('registerClosing.confirmButton')}
        </button>
      </div>

      <div className="flex flex-1 gap-6 overflow-auto">
        <DenomColumn
          title={t('registerClosing.usdBillsTitle')}
          denoms={USD_DENOMS}
          values={usd}
          onChange={(d, v) => setDenom('usd', d, v)}
          fmtDenom={(d) => `$${d}`}
          fmtLine={(d, q) => `$${(d * q).toFixed(2)}`}
          subtotalLabel={`$${usdSubtotal.toFixed(2)}`}
          subtotalCaption={t('registerClosing.subtotalLabel')}
        />
        <DenomColumn
          title={t('registerClosing.khrBillsTitle')}
          denoms={KHR_DENOMS}
          values={khr}
          onChange={(d, v) => setDenom('khr', d, v)}
          fmtDenom={(d) => `${d.toLocaleString()}៛`}
          fmtLine={(d, q) => `${(d * q).toLocaleString()}៛`}
          subtotalLabel={`${khrSubtotal.toLocaleString()}៛ (≈$${khrInUsd.toFixed(2)})`}
          subtotalCaption={t('registerClosing.subtotalLabel')}
        />
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
  subtotalCaption,
}: {
  title: string;
  denoms: number[];
  values: Record<number, number>;
  onChange: (d: number, v: number) => void;
  fmtDenom: (d: number) => string;
  fmtLine: (d: number, q: number) => string;
  subtotalLabel: string;
  subtotalCaption: string;
}) {
  return (
    <div className="flex-1">
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="flex flex-col gap-2">
        {denoms.map((d) => (
          <div key={d} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
            <div className="w-[70px] text-[13px] font-bold">{fmtDenom(d)}</div>
            <div className="h-px flex-1 bg-border" />
            <button onClick={() => onChange(d, values[d] - 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border">
              −
            </button>
            <input
              value={values[d]}
              onChange={(e) => onChange(d, parseInt(e.target.value, 10) || 0)}
              className="h-8 w-[52px] rounded-md border border-border text-center text-[13.5px]"
            />
            <button onClick={() => onChange(d, values[d] + 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-border">
              ＋
            </button>
            <div className="w-[80px] text-right text-[12.5px] text-muted-foreground">{fmtLine(d, values[d])}</div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex justify-between border-t border-dashed border-border pt-2.5 text-[13.5px] font-bold">
        <span>{subtotalCaption}</span>
        <span>{subtotalLabel}</span>
      </div>
    </div>
  );
}
