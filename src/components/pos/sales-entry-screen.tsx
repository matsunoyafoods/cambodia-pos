'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  getManualDailySalesMonth,
  getManualDailySalesForDate,
  saveManualDailySales,
  deleteManualDailySales,
  PosSalesEntryApiError,
  type ManualDailySalesMonth,
} from '@/lib/sales-entry-client';
import { MANUAL_SALES_METHODS, type ManualSalesMethod } from '@/lib/pos-types';
import { downloadCsv } from '@/lib/csv-export';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// 手入力売上画面 (2026-09-24 追加)。Tom「オーダー・会計機能を一時的に使わない間、
// 何月何日に現金売上とカード/QR等の売上がわかるようにしたい」への対応。
// /pos/sales-report (pos.orders 由来の自動集計) とは別のデータソース。owner/manager限定
// (sub_manager は締め出す。/pos/sales-report と同じ方針)。

const METHOD_LABEL_KEY: Record<ManualSalesMethod, string> = {
  cash: 'salesEntry.methodCash',
  creditCard: 'salesEntry.methodCreditCard',
  abaQr: 'salesEntry.methodAbaQr',
  kbQr: 'salesEntry.methodKbQr',
  ppcbQr: 'salesEntry.methodPpcbQr',
  delivery: 'salesEntry.methodDelivery',
  voucher: 'salesEntry.methodVoucher',
};

type FormAmounts = Record<ManualSalesMethod, string>;

function emptyAmounts(): FormAmounts {
  return { cash: '', creditCard: '', abaQr: '', kbQr: '', ppcbQr: '', delivery: '', voucher: '' };
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function methodTotal(amounts: FormAmounts): number {
  return MANUAL_SALES_METHODS.reduce((sum, m) => sum + (Number(amounts[m]) || 0), 0);
}

function amountForMethod(entry: ManualDailySalesMonth['days'][number], method: ManualSalesMethod): number {
  switch (method) {
    case 'cash':
      return entry.cashUsd;
    case 'creditCard':
      return entry.creditCardUsd;
    case 'abaQr':
      return entry.abaQrUsd;
    case 'kbQr':
      return entry.kbQrUsd;
    case 'ppcbQr':
      return entry.ppcbQrUsd;
    case 'delivery':
      return entry.deliveryUsd;
    case 'voucher':
      return entry.voucherUsd;
  }
}

export function SalesEntryScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <SalesEntryScreenInner />
    </LanguageProvider>
  );
}

function SalesEntryScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = me.role === 'owner' || me.role === 'manager';

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t('salesEntry.title')}</div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[980px] flex-col gap-6">
          {!isPosNative ? (
            <PosNativeOnlyNotice />
          ) : !canManage ? (
            <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">{t('common.managerOnly')}</div>
          ) : (
            <SalesEntryPanel />
          )}
        </div>
      </div>
    </div>
  );
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

function SalesEntryPanel() {
  const { t } = useLanguage();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<ManualDailySalesMonth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(todayDate());
  const [amounts, setAmounts] = useState<FormAmounts>(emptyAmounts());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getManualDailySalesMonth(month)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof PosSalesEntryApiError ? err.message : t('salesEntry.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, t]);

  useEffect(() => reload(), [reload]);

  // 日付を選ぶと、既にその日の記録があれば自動でフォームに読み込む (=上書き編集になる)。
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    getManualDailySalesForDate(date)
      .then(({ entry }) => {
        if (cancelled) return;
        if (entry) {
          setEditingId(entry.id);
          setAmounts({
            cash: String(entry.cashUsd),
            creditCard: String(entry.creditCardUsd),
            abaQr: String(entry.abaQrUsd),
            kbQr: String(entry.kbQrUsd),
            ppcbQr: String(entry.ppcbQrUsd),
            delivery: String(entry.deliveryUsd),
            voucher: String(entry.voucherUsd),
          });
          setNote(entry.note ?? '');
        } else {
          setEditingId(null);
          setAmounts(emptyAmounts());
          setNote('');
        }
      })
      .catch(() => {
        // プリフィル失敗は致命的ではないので静かに無視 (保存時に改めてエラーが出る)。
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  function loadForEdit(entry: ManualDailySalesMonth['days'][number]) {
    setDate(entry.date);
    setEditingId(entry.id);
    setAmounts({
      cash: String(entry.cashUsd),
      creditCard: String(entry.creditCardUsd),
      abaQr: String(entry.abaQrUsd),
      kbQr: String(entry.kbQrUsd),
      ppcbQr: String(entry.ppcbQrUsd),
      delivery: String(entry.deliveryUsd),
      voucher: String(entry.voucherUsd),
    });
    setNote(entry.note ?? '');
    setFormError(null);
  }

  function resetForm() {
    setDate(todayDate());
    setEditingId(null);
    setAmounts(emptyAmounts());
    setNote('');
    setFormError(null);
  }

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    try {
      await saveManualDailySales({
        date,
        cashUsd: Number(amounts.cash) || 0,
        creditCardUsd: Number(amounts.creditCard) || 0,
        abaQrUsd: Number(amounts.abaQr) || 0,
        kbQrUsd: Number(amounts.kbQr) || 0,
        ppcbQrUsd: Number(amounts.ppcbQr) || 0,
        deliveryUsd: Number(amounts.delivery) || 0,
        voucherUsd: Number(amounts.voucher) || 0,
        note: note.trim() || undefined,
      });
      resetForm();
      reload();
    } catch (err) {
      setFormError(err instanceof PosSalesEntryApiError ? err.message : t('salesEntry.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteManualDailySales(deleteTarget);
      setDeleteTarget(null);
      if (editingId === deleteTarget) resetForm();
      reload();
    } catch {
      // 削除エラーはモーダル内には出さず、単に閉じずに再試行可能な状態にする。
    } finally {
      setDeleting(false);
    }
  }

  function handleCsvExport() {
    if (!data || data.days.length === 0) return;
    downloadCsv(
      `${t('salesEntry.csvFilename')}_${month}`,
      [t('salesEntry.csvDate'), ...MANUAL_SALES_METHODS.map((m) => t(METHOD_LABEL_KEY[m])), t('salesEntry.colTotal'), t('salesEntry.colNote')],
      data.days.map((d) => [
        d.date,
        ...MANUAL_SALES_METHODS.map((m) => amountForMethod(d, m).toFixed(2)),
        (d.cashUsd + d.creditCardUsd + d.abaQrUsd + d.kbQrUsd + d.ppcbQrUsd + d.deliveryUsd + d.voucherUsd).toFixed(2),
        d.note ?? '',
      ]),
    );
  }

  const formTotal = methodTotal(amounts);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-[12.5px] leading-relaxed text-amber-900">
        {t('salesEntry.pageNote')}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 text-[13.5px] font-semibold">{editingId ? t('salesEntry.formTitleEdit') : t('salesEntry.formTitleNew')}</div>
        <div className="mb-3">
          <label className="mb-1 block text-[12.5px] font-semibold">{t('salesEntry.dateLabel')}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MANUAL_SALES_METHODS.map((m) => (
            <div key={m}>
              <label className="mb-1 block text-[12px] font-semibold text-muted-foreground">{t(METHOD_LABEL_KEY[m])}</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amounts[m]}
                onChange={(e) => setAmounts((prev) => ({ ...prev, [m]: e.target.value }))}
                placeholder="0.00"
                className="h-10 w-full rounded-lg border border-border px-2.5 text-[13px]"
              />
            </div>
          ))}
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-[12.5px] font-semibold">{t('salesEntry.noteLabel')}</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('salesEntry.notePlaceholder')}
            className="h-10 w-full rounded-lg border border-border px-2.5 text-[13px]"
          />
        </div>
        <div className="mb-3 flex items-center justify-between rounded-lg bg-secondary/30 px-3.5 py-2.5">
          <span className="text-[12.5px] font-semibold text-muted-foreground">{t('salesEntry.formTotalLabel')}</span>
          <span className="text-[17px] font-extrabold">${formTotal.toFixed(2)}</span>
        </div>
        {formError && <div className="mb-3 text-[12.5px] text-destructive">{formError}</div>}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-10 rounded-lg bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md disabled:opacity-60"
          >
            {saving ? t('salesEntry.saveSubmitting') : t('salesEntry.saveButton')}
          </button>
          {editingId && (
            <button onClick={resetForm} disabled={saving} className="h-10 rounded-lg border border-border px-4 text-[13px] font-semibold disabled:opacity-60">
              {t('salesEntry.cancelEditButton')}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="text-[13.5px] font-semibold">{t('salesEntry.listTitle')}</div>
          <div className="flex items-center gap-2.5">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[13px]" />
            <button
              onClick={handleCsvExport}
              disabled={!data || data.days.length === 0}
              className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
            >
              {t('salesEntry.csvExportButton')}
            </button>
          </div>
        </div>

        {error && <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12.5px] text-destructive">{error}</div>}
        {loading && <div className="text-[13px] text-muted-foreground">{t('common.loadingEllipsis')}</div>}

        {data && !loading && (
          <>
            <div className="mb-3 flex items-center justify-between rounded-lg bg-secondary/30 px-3.5 py-2.5">
              <span className="text-[12.5px] font-semibold text-muted-foreground">{t('salesEntry.monthTotalLabel')}</span>
              <span className="text-[17px] font-extrabold">${data.grandTotal.toFixed(2)}</span>
            </div>
            {data.days.length === 0 ? (
              <div className="text-[13px] text-muted-foreground">{t('salesEntry.noEntries')}</div>
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-secondary/60">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">{t('salesEntry.csvDate')}</th>
                      {MANUAL_SALES_METHODS.map((m) => (
                        <th key={m} className="px-3 py-2 text-right font-semibold">
                          {t(METHOD_LABEL_KEY[m])}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-semibold">{t('salesEntry.colTotal')}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t('salesEntry.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => {
                      const rowTotal = d.cashUsd + d.creditCardUsd + d.abaQrUsd + d.kbQrUsd + d.ppcbQrUsd + d.deliveryUsd + d.voucherUsd;
                      return (
                        <tr key={d.id} className="border-t border-border">
                          <td className="px-3 py-2">{d.date}</td>
                          <td className="px-3 py-2 text-right">${d.cashUsd.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">${d.creditCardUsd.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">${d.abaQrUsd.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">${d.kbQrUsd.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">${d.ppcbQrUsd.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">${d.deliveryUsd.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">${d.voucherUsd.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-semibold">${rowTotal.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1.5">
                              <button onClick={() => loadForEdit(d)} className="h-7 rounded-md border border-border px-2.5 text-[11.5px] font-semibold">
                                {t('salesEntry.editButton')}
                              </button>
                              <button
                                onClick={() => setDeleteTarget(d.id)}
                                className="h-7 rounded-md border border-destructive/40 px-2.5 text-[11.5px] font-semibold text-destructive hover:bg-destructive/5"
                              >
                                {t('salesEntry.deleteButton')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="w-full max-w-[420px] rounded-xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-[15px] font-bold">{t('salesEntry.deleteConfirmTitle')}</div>
            <p className="mb-4 text-[12.5px] leading-relaxed text-muted-foreground">{t('salesEntry.deleteConfirmBody')}</p>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="h-9 rounded-lg border border-border px-3.5 text-[13px] font-semibold disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="h-9 rounded-lg bg-destructive px-3.5 text-[13px] font-bold text-destructive-foreground disabled:opacity-60"
              >
                {deleting ? t('salesEntry.deleteSubmitting') : t('salesEntry.deleteButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
