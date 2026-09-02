'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import { getDailySales, getTableSalesReport, PosSalesReportApiError, type DailySales, type TableSalesReport } from '@/lib/sales-report-client';
import { downloadCsv } from '@/lib/csv-export';

// 売上レポート画面 (2026-09-02 追加)。Tom「月間日々売上・日々のテーブルごとの詳細（金額、
// 国籍、人数、単価）が出るようにしてダウンロードできるように」への対応。AI分析 (/pos/insights)
// とは別画面として新設した (Tom確認済み)。owner/manager限定 (店舗の売上が見える情報のため)。

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function SalesReportScreen() {
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = me.role === 'owner' || me.role === 'manager';

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← レジ画面へ
        </button>
        <div className="text-[15px] font-bold">売上レポート</div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[980px] flex-col gap-6">
          {!isPosNative ? (
            <PosNativeOnlyNotice />
          ) : !canManage ? (
            <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">この画面は manager 以上のみ利用できます。</div>
          ) : (
            <SalesReportPanel />
          )}
        </div>
      </div>
    </div>
  );
}

function PosNativeOnlyNotice() {
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
      <p className="mb-2 font-bold">POS PINログインが必要です</p>
      <p className="mb-3 text-[13px] leading-relaxed">
        売上レポートは現在、POS PINログイン (スタッフ選択 + PINでのログイン) をした端末専用です。matsunoya-dine
        (Telegram) のログインだけではこの画面のデータは扱えません。
      </p>
      <a href="/login" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md">
        PINでログインする
      </a>
    </div>
  );
}

function SalesReportPanel() {
  const [month, setMonth] = useState(currentMonth());
  const [daily, setDaily] = useState<DailySales | null>(null);
  const [tables, setTables] = useState<TableSalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getDailySales(month), getTableSalesReport(month)])
      .then(([d, t]) => {
        if (cancelled) return;
        setDaily(d);
        setTables(t);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof PosSalesReportApiError ? err.message : '売上レポートの取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  function handleDailyCsvExport() {
    if (!daily || daily.days.length === 0) return;
    downloadCsv(
      `月間日々売上_${month}`,
      ['日付', '売上(USD)', '会計件数'],
      daily.days.map((d) => [d.date, d.total.toFixed(2), d.orderCount]),
    );
  }

  function handleTablesCsvExport() {
    if (!tables || tables.rows.length === 0) return;
    downloadCsv(
      `テーブル別売上明細_${month}`,
      ['日付', '卓', '金額(USD)', '国籍内訳', '人数', '単価(USD)'],
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
        <div className="mb-3 text-[13.5px] font-semibold">対象月</div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />
        </div>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-[13px] text-destructive">{error}</div>}
      {loading && <div className="text-[13px] text-muted-foreground">読み込み中…</div>}

      {daily && !loading && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
            <div className="text-[13.5px] font-semibold">月間日々売上</div>
            <button
              onClick={handleDailyCsvExport}
              disabled={daily.days.length === 0}
              className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
            >
              CSV出力
            </button>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Stat label="月間売上合計" value={`$${daily.monthTotal.toFixed(2)}`} />
            <Stat label="会計件数" value={`${daily.orderCount}件`} />
          </div>
          {daily.days.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">この月の売上データはまだありません。</div>
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-secondary/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">日付</th>
                    <th className="px-3 py-2 text-right font-semibold">売上</th>
                    <th className="px-3 py-2 text-right font-semibold">会計件数</th>
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
            <div className="text-[13.5px] font-semibold">日々のテーブルごとの詳細</div>
            <button
              onClick={handleTablesCsvExport}
              disabled={tables.rows.length === 0}
              className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
            >
              CSV出力
            </button>
          </div>
          <p className="mb-3 text-[11.5px] text-muted-foreground">
            国籍・人数は会計時に記録した客層情報 (§0.1d) を使用します。未記録の会計は人数0件・単価算出不能として表示されます。
          </p>
          {tables.rows.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">この月の会計データはまだありません。</div>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-secondary/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">日付</th>
                    <th className="px-3 py-2 text-left font-semibold">卓</th>
                    <th className="px-3 py-2 text-right font-semibold">金額</th>
                    <th className="px-3 py-2 text-left font-semibold">国籍内訳</th>
                    <th className="px-3 py-2 text-right font-semibold">人数</th>
                    <th className="px-3 py-2 text-right font-semibold">単価</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.rows.map((r) => (
                    <tr key={r.orderId} className="border-t border-border">
                      <td className="px-3 py-2">{r.date}</td>
                      <td className="px-3 py-2">{r.tableCode}</td>
                      <td className="px-3 py-2 text-right">${r.total.toFixed(2)}</td>
                      <td className="px-3 py-2">{r.ethnicity.length > 0 ? r.ethnicity.map((e) => `${e.label}${e.count}`).join(' / ') : '未記録'}</td>
                      <td className="px-3 py-2 text-right">{r.partySize}</td>
                      <td className="px-3 py-2 text-right">{r.unitPrice != null ? `$${r.unitPrice.toFixed(2)}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
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
