'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  getDailySales,
  getTableSalesReport,
  getVoidHistory,
  voidOrder,
  PosSalesReportApiError,
  type DailySales,
  type TableSalesReport,
  type VoidHistory,
} from '@/lib/sales-report-client';
import { downloadCsv } from '@/lib/csv-export';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// 売上レポート画面 (2026-09-02 追加)。Tom「月間日々売上・日々のテーブルごとの詳細（金額、
// 国籍、人数、単価）が出るようにしてダウンロードできるように」への対応。AI分析 (/pos/insights)
// とは別画面として新設した (Tom確認済み)。owner/manager限定 (店舗の売上が見える情報のため)。

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function SalesReportScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <SalesReportScreenInner />
    </LanguageProvider>
  );
}

function SalesReportScreenInner() {
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
        <div className="text-[15px] font-bold">{t('salesReport.title')}</div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[980px] flex-col gap-6">
          {!isPosNative ? (
            <PosNativeOnlyNotice />
          ) : !canManage ? (
            <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">{t('common.managerOnly')}</div>
          ) : (
            <SalesReportPanel />
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

function SalesReportPanel() {
  const { t } = useLanguage();
  const [month, setMonth] = useState(currentMonth());
  const [daily, setDaily] = useState<DailySales | null>(null);
  const [tables, setTables] = useState<TableSalesReport | null>(null);
  const [voidHistory, setVoidHistory] = useState<VoidHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 会計取消 (2026-09-20 追加)。取消対象の orderId を保持している間だけ確認モーダルを表示する。
  const [voidTarget, setVoidTarget] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getDailySales(month), getTableSalesReport(month), getVoidHistory(month)])
      .then(([d, tbl, v]) => {
        if (cancelled) return;
        setDaily(d);
        setTables(tbl);
        setVoidHistory(v);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof PosSalesReportApiError ? err.message : t('salesReport.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, t]);

  useEffect(() => reload(), [reload]);

  function handleDailyCsvExport() {
    if (!daily || daily.days.length === 0) return;
    downloadCsv(
      `${t('salesReport.dailyCsvFilename')}_${month}`,
      [t('salesReport.csvDate'), t('salesReport.csvSalesUsd'), t('salesReport.csvOrderCount')],
      daily.days.map((d) => [d.date, d.total.toFixed(2), d.orderCount]),
    );
  }

  function handleTablesCsvExport() {
    if (!tables || tables.rows.length === 0) return;
    downloadCsv(
      `${t('salesReport.tablesCsvFilename')}_${month}`,
      [t('salesReport.csvDate'), t('salesReport.csvTable'), t('salesReport.csvAmountUsd'), t('salesReport.csvEthnicity'), t('salesReport.csvPartySize'), t('salesReport.csvUnitPriceUsd')],
      tables.rows.map((r) => [
        r.date,
        r.tableCode,
        r.total.toFixed(2),
        r.ethnicity.map((e) => `${e.label}${e.count}`).join(' / '),
        r.partySize,
        r.unitPrice != null ? r.unitPrice.toFixed(2) : '',
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 text-[13.5px] font-semibold">{t('salesReport.targetMonth')}</div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />
        </div>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-[13px] text-destructive">{error}</div>}
      {loading && <div className="text-[13px] text-muted-foreground">{t('common.loadingEllipsis')}</div>}

      {daily && !loading && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
            <div className="text-[13.5px] font-semibold">{t('salesReport.dailySalesTitle')}</div>
            <button
              onClick={handleDailyCsvExport}
              disabled={daily.days.length === 0}
              className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
            >
              {t('salesReport.csvExportButton')}
            </button>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Stat label={t('salesReport.monthTotalLabel')} value={`$${daily.monthTotal.toFixed(2)}`} />
            <Stat label={t('salesReport.orderCountLabel')} value={t('salesReport.orderCountValue', { count: daily.orderCount })} />
          </div>
          {daily.days.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">{t('salesReport.noDailyData')}</div>
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-secondary/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.csvDate')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('salesReport.salesColumn')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('salesReport.csvOrderCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.days.map((d) => (
                    <tr key={d.date} className="border-t border-border">
                      <td className="px-3 py-2">{d.date}</td>
                      <td className="px-3 py-2 text-right">${d.total.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{d.orderCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tables && !loading && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
            <div className="text-[13.5px] font-semibold">{t('salesReport.tableDetailTitle')}</div>
            <button
              onClick={handleTablesCsvExport}
              disabled={tables.rows.length === 0}
              className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
            >
              {t('salesReport.csvExportButton')}
            </button>
          </div>
          <p className="mb-3 text-[11.5px] text-muted-foreground">{t('salesReport.tableDetailNote')}</p>
          {tables.rows.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">{t('salesReport.noTableData')}</div>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-secondary/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.csvDate')}</th>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.csvTable')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('salesReport.amountColumn')}</th>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.csvEthnicity')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('salesReport.csvPartySize')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('salesReport.unitPriceColumn')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('salesReport.voidActionColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.rows.map((r) => (
                    <tr key={r.orderId} className="border-t border-border">
                      <td className="px-3 py-2">{r.date}</td>
                      <td className="px-3 py-2">{r.tableCode}</td>
                      <td className="px-3 py-2 text-right">${r.total.toFixed(2)}</td>
                      <td className="px-3 py-2">{r.ethnicity.length > 0 ? r.ethnicity.map((e) => `${e.label}${e.count}`).join(' / ') : t('salesReport.notRecorded')}</td>
                      <td className="px-3 py-2 text-right">{r.partySize}</td>
                      <td className="px-3 py-2 text-right">{r.unitPrice != null ? `$${r.unitPrice.toFixed(2)}` : '-'}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setVoidTarget(r.orderId)}
                          className="h-7 rounded-md border border-destructive/40 px-2.5 text-[11.5px] font-semibold text-destructive hover:bg-destructive/5"
                        >
                          {t('salesReport.voidButton')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {voidHistory && !loading && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 text-[13.5px] font-semibold">{t('salesReport.voidHistoryTitle')}</div>
          <p className="mb-3 text-[11.5px] text-muted-foreground">{t('salesReport.voidHistoryNote')}</p>
          {voidHistory.rows.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">{t('salesReport.noVoidHistory')}</div>
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-secondary/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.voidHistoryAtColumn')}</th>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.voidHistoryTableColumn')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('salesReport.voidHistoryAmountColumn')}</th>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.voidHistoryReasonColumn')}</th>
                    <th className="px-3 py-2 text-left font-semibold">{t('salesReport.voidHistoryByColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {voidHistory.rows.map((v) => (
                    <tr key={v.id} className="border-t border-border">
                      <td className="px-3 py-2">{v.voidedAt}</td>
                      <td className="px-3 py-2">{v.tableCode}</td>
                      <td className="px-3 py-2 text-right">${v.voidedTotal.toFixed(2)}</td>
                      <td className="px-3 py-2">{v.reason || t('salesReport.voidHistoryNoReason')}</td>
                      <td className="px-3 py-2">{v.voidedByName ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {voidTarget && <VoidOrderModal orderId={voidTarget} onClose={() => setVoidTarget(null)} onVoided={reload} />}
    </div>
  );
}

function VoidOrderModal({ orderId, onClose, onVoided }: { orderId: string; onClose: () => void; onVoided: () => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await voidOrder(orderId, reason.trim() || undefined);
      onVoided();
      onClose();
    } catch (err) {
      setError(err instanceof PosSalesReportApiError ? err.message : t('salesReport.voidError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-[15px] font-bold">{t('salesReport.voidModalTitle')}</div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted-foreground">{t('salesReport.voidModalBody')}</p>
        <label className="mb-1 block text-[12.5px] font-semibold">{t('salesReport.voidReasonLabel')}</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('salesReport.voidReasonPlaceholder')}
          rows={2}
          className="mb-3 w-full resize-none rounded-lg border border-border p-2.5 text-[13px]"
        />
        {error && <div className="mb-3 text-[12.5px] text-destructive">{error}</div>}
        <div className="flex justify-end gap-2.5">
          <button onClick={onClose} disabled={submitting} className="h-9 rounded-lg border border-border px-3.5 text-[13px] font-semibold disabled:opacity-60">
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="h-9 rounded-lg bg-destructive px-3.5 text-[13px] font-bold text-destructive-foreground disabled:opacity-60"
          >
            {submitting ? t('salesReport.voidSubmitting') : t('salesReport.voidConfirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-[17px] font-bold">{value}</div>
    </div>
  );
}
