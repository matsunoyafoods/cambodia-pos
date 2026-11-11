'use client';

import { useEffect, useMemo, useState } from 'react';
import { getClosingReport, PosSalesReportApiError, type ClosingReport } from '@/lib/sales-report-client';
import { downloadCsv } from '@/lib/csv-export';
import { useLanguage } from './language-context';

// レジ締め月報 (Cash Register Closing Report、2026-11-11 追加)。
// Tom「税理士がこの情報が入っていてほしい」→ 従来手作業で作っていた月報と同じ列で、
// POS のデータから毎月出力できるようにした。列見出しは税理士に渡す書式のため、画面の表示言語に
// 関係なく「英語 + 日本語」で固定する (元の月報と同じ)。CSV (Excel) と 印刷/PDF の2形式で出力。

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function money(n: number | null | undefined, blankZero = true): string {
  if (n === null || n === undefined) return '';
  if (blankZero && Math.abs(n) < 0.005) return '';
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
}

type Row = {
  date: string;
  dow: string;
  open: number | null;
  final: number | null;
  cash: number;
  byMethod: Record<string, number>;
  total: number;
  unknown: number;
  pettyCash: number;
  netCash: number;
  deposit: number;
  balance: number;
};

export function ClosingReportSection({ month }: { month: string }) {
  const { t } = useLanguage();
  const [report, setReport] = useState<ClosingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carryDraft, setCarryDraft] = useState('0');
  const [note, setNote] = useState('');

  useEffect(() => {
    setReport(null);
    setError(null);
    getClosingReport(month)
      .then((r) => {
        setReport(r);
        setCarryDraft((r.carryForward ?? 0).toFixed(2));
      })
      .catch((err) => setError(err instanceof PosSalesReportApiError ? err.message : t('closingReport.loadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const carryForward = Number.isFinite(parseFloat(carryDraft)) ? parseFloat(carryDraft) : 0;

  const rows: Row[] = useMemo(() => {
    if (!report) return [];
    let balance = carryForward;
    return report.days.map((d) => {
      balance = Math.round((balance + d.netCash - d.deposit) * 100) / 100;
      if (report.baseline && d.date === report.baseline.asOfDate) balance = report.baseline.amountUsd;
      return {
        date: d.date,
        dow: DOW_JA[new Date(`${d.date}T00:00:00Z`).getUTCDay()],
        open: d.open,
        final: d.final,
        cash: d.cash,
        byMethod: d.byMethod,
        total: d.total,
        unknown: d.unknown,
        pettyCash: d.pettyCash,
        netCash: d.netCash,
        deposit: d.deposit,
        balance,
      };
    });
  }, [report, carryForward]);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-[12.5px] text-destructive">{error}</div>
    );
  }

  const methods = report?.methods ?? [];
  const cashLabel = report?.cashLabel ?? 'Cash';
  const headers = [
    'date',
    'DoW',
    'OPEN レジ開け現金',
    'FINAL レジ締め現金',
    `${cashLabel} 現金`,
    ...methods,
    'TOTAL 合計売上',
    'unknown(+) 不明金',
    'petty cash(-) 小口資金',
    'Net Cash Sales 現金売上',
    'Bank Deposit 納金額',
    'Cash Balance 納金袋残高',
  ];
  const sum = (f: (r: Row) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100;
  const totals = {
    cash: sum((r) => r.cash),
    byMethod: Object.fromEntries(methods.map((m) => [m, sum((r) => r.byMethod[m] ?? 0)])),
    total: sum((r) => r.total),
    unknown: sum((r) => r.unknown),
    pettyCash: sum((r) => r.pettyCash),
    netCash: sum((r) => r.netCash),
    deposit: sum((r) => r.deposit),
  };
  const endBalance = rows.length > 0 ? rows[rows.length - 1].balance : carryForward;

  function rowCells(r: Row): string[] {
    return [
      r.date.slice(5).replace('-', '/'),
      r.dow,
      money(r.open, false),
      money(r.final, false),
      money(r.cash),
      ...methods.map((m) => money(r.byMethod[m] ?? 0)),
      money(r.total),
      money(r.unknown),
      money(r.pettyCash),
      money(r.netCash, false),
      money(r.deposit),
      money(r.balance, false),
    ];
  }
  function totalCells(): string[] {
    return [
      'TOTAL',
      '',
      '',
      '',
      money(totals.cash, false),
      ...methods.map((m) => money(totals.byMethod[m], false)),
      money(totals.total, false),
      money(totals.unknown, false),
      money(totals.pettyCash, false),
      money(totals.netCash, false),
      money(totals.deposit, false),
      money(endBalance, false),
    ];
  }
  const [yy, mm] = month.split('-');
  const titleLine = `${yy} / ${Number(mm)}  Cash Register Closing Report  1$=${report?.khrRate ?? ''}Riel  Carry-forward Balance 前月繰越 ${money(carryForward, false)}`;

  function exportCsv() {
    if (!report) return;
    const plain = (cells: string[]) => cells.map((c) => c.replace('$', ''));
    downloadCsv(
      `Cash_Register_Closing_Report_${month}`,
      [titleLine],
      [
        headers,
        ...rows.map((r) => plain(rowCells(r))),
        plain(totalCells()),
        ...(note.trim() ? [[`Note 備考: ${note.trim()}`]] : []),
      ],
    );
  }

  function printReport() {
    if (!report) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
    const body = rows
      .map((r) => `<tr>${rowCells(r).map((c, i) => `<td class="${i < 2 ? 'l' : ''}">${esc(c)}</td>`).join('')}</tr>`)
      .join('');
    const foot = `<tr class="tot">${totalCells().map((c, i) => `<td class="${i < 2 ? 'l' : ''}">${esc(c)}</td>`).join('')}</tr>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cash Register Closing Report ${month}</title>
<style>@page{size:A4 landscape;margin:8mm}body{font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;font-size:9px;color:#111}
h1{font-size:12px;margin:0 0 6px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:2px 4px;text-align:right;white-space:nowrap}
th{background:#f3f3f3;font-size:8.5px;text-align:center;white-space:normal}td.l{text-align:left}tr.tot td{font-weight:bold;background:#fafafa}.note{margin-top:8px;font-size:10px;white-space:pre-wrap}</style>
</head><body><h1>${esc(titleLine)}</h1><table><thead><tr>${th}</tr></thead><tbody>${body}${foot}</tbody></table>
${note.trim() ? `<div class="note">Note 備考: ${esc(note.trim())}</div>` : ''}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13.5px] font-semibold">{t('closingReport.title')}</div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            disabled={!report}
            className="h-9 rounded-lg border border-border bg-card px-3 text-[12.5px] font-semibold disabled:opacity-50"
          >
            {t('closingReport.csvButton')}
          </button>
          <button
            onClick={printReport}
            disabled={!report}
            className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t('closingReport.printButton')}
          </button>
        </div>
      </div>
      <div className="mb-3 text-[11.5px] text-muted-foreground">{t('closingReport.description')}</div>

      <div className="mb-3 flex flex-wrap items-end gap-4">
        <label className="text-[12px]">
          <div className="mb-1 text-muted-foreground">{t('closingReport.carryForwardLabel')}</div>
          <input
            type="number"
            step="0.01"
            value={carryDraft}
            onChange={(e) => setCarryDraft(e.target.value)}
            className="h-9 w-32 rounded-lg border border-border px-2 text-right text-[13px]"
          />
        </label>
        {report && report.carryForward === null && (
          <div className="pb-2 text-[11px] text-muted-foreground">{t('closingReport.carryForwardManualHint')}</div>
        )}
        <label className="min-w-[260px] flex-1 text-[12px]">
          <div className="mb-1 text-muted-foreground">{t('closingReport.noteLabel')}</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('closingReport.notePlaceholder')}
            className="h-9 w-full rounded-lg border border-border px-2 text-[12.5px]"
          />
        </label>
      </div>

      {!report ? (
        <div className="text-[12.5px] text-muted-foreground">{t('common.loadingEllipsis')}</div>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0 bg-secondary/80">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-2 py-1.5 text-center font-semibold leading-tight">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className={'border-t border-border' + (r.total === 0 && !r.final ? ' text-muted-foreground' : '')}>
                  {rowCells(r).map((c, i) => (
                    <td key={i} className={'whitespace-nowrap px-2 py-1 ' + (i < 2 ? 'text-left' : 'text-right')}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-secondary/40 font-bold">
                {totalCells().map((c, i) => (
                  <td key={i} className={'whitespace-nowrap px-2 py-1.5 ' + (i < 2 ? 'text-left' : 'text-right')}>
                    {c}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
