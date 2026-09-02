/**
 * AI分析・課題提案 (2026-09-01 追加) の同一オリジン API クライアント。
 * ボタン押下のたびに /api/analysis/insights を呼び出し、Gemini APIによる分析結果を取得する
 * (自動実行・保存はしない。呼び出しごとにAPI利用料が発生するため常にユーザー操作起点)。
 * 2026-09-02 追加: `lang` を渡すと、サーバー側が日本語で生成した結果をその言語へ翻訳して返す
 * (分析ロジック自体は常に日本語のまま行う。詳細は route.ts のコメント参照)。
 */

import type { Lang } from '@/lib/i18n/lang';

export class PosAnalysisApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosAnalysisApiError';
  }
}

export type PeriodSummary = {
  from: string;
  to: string;
  expenseTotal: number;
  expenseByCategory: { category: string; total: number }[];
  unpaidTotal: number;
  laborCostTotal: number;
  laborHoursTotal: number;
  laborByStaff: { staffName: string; hours: number; cost: number }[];
};

export type InsightsResult = {
  summary: string;
  findings: string[];
  suggestions: string[];
  current: PeriodSummary;
  previous: PeriodSummary;
  /** 表示言語への翻訳に失敗し、日本語のまま返された場合に true。 */
  translationFailed?: boolean;
};

export async function generateInsights(from: string, to: string, lang?: Lang): Promise<InsightsResult> {
  const res = await fetch('/api/analysis/insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, lang }),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new PosAnalysisApiError(message, res.status);
  }
  return res.json() as Promise<InsightsResult>;
}
