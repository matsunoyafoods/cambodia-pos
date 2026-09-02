'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import { generateInsights, PosAnalysisApiError, type InsightsResult } from '@/lib/analysis-client';

// AI分析・課題提案 (2026-09-01 追加。Tom「AI分析・課題提案そのもの」への対応、データ収集・
// AI分析機能の第二弾)。経費・勤怠 (§0.1f) で集めたデータを Gemini API に渡し、自然言語の
// 分析コメント・改善提案をその場で生成する。ボタン押下のオンデマンド生成のみ (自動実行はしない。
// 呼び出しごとにAPI利用料が発生するため、必ずTomの操作起点にする)。owner/manager限定。

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function InsightsScreen() {
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
        <div className="text-[15px] font-bold">AI分析</div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[820px] flex-col gap-6">
          {!isPosNative ? (
            <PosNativeOnlyNotice />
          ) : !canManage ? (
            <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">この画面は manager 以上のみ利用できます。</div>
          ) : (
            <InsightsPanel />
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
        AI分析は現在、POS PINログイン (スタッフ選択 + PINでのログイン) をした端末専用です。matsunoya-dine
        (Telegram) のログインだけではこの画面のデータは扱えません。
      </p>
      <a href="/login" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md">
        PINでログインする
      </a>
    </div>
  );
}

function InsightsPanel() {
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InsightsResult | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await generateInsights(from, to);
      setResult(r);
    } catch (err) {
      setError(err instanceof PosAnalysisApiError ? err.message : '分析の生成に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 text-[13.5px] font-semibold">分析する期間</div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />
          <span className="text-[12px] text-muted-foreground">〜</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />
          <button onClick={run} disabled={loading} className="h-10 rounded-lg bg-primary px-5 text-[13px] font-bold text-primary-foreground disabled:opacity-50">
            {loading ? '分析中…' : '分析を実行'}
          </button>
        </div>
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          この期間の経費・勤怠データを直前の同じ日数分の期間と比較して分析します。実行のたびにAI (Gemini)
          へのAPI呼び出しが発生します (自動実行はしません)。
        </p>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-[13px] text-destructive">{error}</div>}

      {loading && <div className="text-[13px] text-muted-foreground">分析しています…</div>}

      {result && !loading && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-2 text-[13.5px] font-semibold">要約</div>
            <p className="text-[13.5px] leading-relaxed">{result.summary}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-2 text-[13.5px] font-semibold">気づいた点</div>
            <ul className="flex flex-col gap-2">
              {result.findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                  <span className="text-muted-foreground">・</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-2 text-[13.5px] font-semibold text-emerald-800">改善提案</div>
            <ul className="flex flex-col gap-2">
              {result.suggestions.map((s, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-emerald-900">
                  <span>・</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-secondary/20 p-5 text-[12px] text-muted-foreground">
            <div className="mb-1 font-semibold text-foreground">元データ (対象期間 {result.current.from} 〜 {result.current.to})</div>
            <div>
              経費合計 ${result.current.expenseTotal.toFixed(2)} (買掛 ${result.current.unpaidTotal.toFixed(2)}) ・ 概算人件費 ${result.current.laborCostTotal.toFixed(2)} (実働{' '}
              {result.current.laborHoursTotal.toFixed(1)}時間)
            </div>
            <div className="mt-1">
              比較期間 ({result.previous.from} 〜 {result.previous.to}): 経費 ${result.previous.expenseTotal.toFixed(2)} ・ 概算人件費 ${result.previous.laborCostTotal.toFixed(2)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
