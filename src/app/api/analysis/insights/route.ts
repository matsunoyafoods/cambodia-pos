import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { applyTimecardRounding } from '@/lib/timecard-rounding';
import { DEFAULT_TIMECARD_ROUNDING, type TimecardRoundingSettings } from '@/lib/pos-types';

// AI分析・課題提案 (2026-09-01 追加。Tom「データ収集・AI分析機能」の第二弾)。
// 経費・勤怠 (データ収集・AI分析 第一弾、§0.1f) で集めたデータを Gemini API に渡し、
// 自然言語の分析コメント・改善提案を生成する。ボタン押下のオンデマンド生成のみ (自動実行・
// 定期実行はしない。APIコストを都度Tomの判断で発生させるため)。結果は保存しない (毎回その場で生成)。
//
// 必須環境変数: GEMINI_API_KEY (Google AI Studio / Vertex AI で発行)。
// 任意: GEMINI_MODEL (未設定なら gemini-2.5-flash)。

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function workedMinutes(clockIn: string, clockOut: string | null, breaks: { startedAt: string; endedAt: string | null }[]): number {
  const start = new Date(clockIn).getTime();
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  let breakMs = 0;
  for (const b of breaks) {
    const bStart = new Date(b.startedAt).getTime();
    const bEnd = b.endedAt ? new Date(b.endedAt).getTime() : Date.now();
    breakMs += Math.max(0, bEnd - bStart);
  }
  return Math.max(0, Math.round((end - start - breakMs) / 60000));
}

async function getRoundingSettings(supabase: ReturnType<typeof createPosAdminClient>, storeId: string): Promise<TimecardRoundingSettings> {
  const { data } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  const stored = (data?.settings && typeof data.settings === 'object' ? (data.settings as Record<string, unknown>).timecardRounding : undefined) as
    | Partial<TimecardRoundingSettings>
    | undefined;
  if (!stored) return DEFAULT_TIMECARD_ROUNDING;
  const unit = stored.unitMinutes;
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_TIMECARD_ROUNDING.enabled,
    unitMinutes: unit === 5 || unit === 10 || unit === 15 || unit === 30 ? unit : DEFAULT_TIMECARD_ROUNDING.unitMinutes,
    direction: stored.direction === 'up' || stored.direction === 'down' || stored.direction === 'nearest' ? stored.direction : DEFAULT_TIMECARD_ROUNDING.direction,
  };
}

type PeriodSummary = {
  from: string;
  to: string;
  expenseTotal: number;
  expenseByCategory: { category: string; total: number }[];
  unpaidTotal: number;
  laborCostTotal: number;
  laborHoursTotal: number;
  laborByStaff: { staffName: string; hours: number; cost: number }[];
};

async function summarizePeriod(supabase: ReturnType<typeof createPosAdminClient>, storeId: string, from: string, to: string, rounding: TimecardRoundingSettings): Promise<PeriodSummary> {
  const [{ data: expenses }, { data: timecards }, { data: staff }] = await Promise.all([
    supabase.from('expenses').select('amount_usd, category, payment_status').eq('store_id', storeId).gte('date', from).lte('date', to),
    supabase.from('timecards').select('staff_id, clock_in, clock_out, breaks').gte('clock_in', `${from}T00:00:00Z`).lte('clock_in', `${to}T23:59:59Z`),
    supabase.from('staff').select('id, display_name, hourly_wage_usd').eq('store_id', storeId),
  ]);

  const staffById = new Map((staff ?? []).map((s) => [s.id as string, s as { id: string; display_name: string; hourly_wage_usd: number | null }]));
  // timecards には store_id が無いため、自店舗の staff.id 集合でフィルタする (テナント分離。他のtimecards APIと同じ方針)。
  const ownTimecards = (timecards ?? []).filter((t) => staffById.has(t.staff_id as string));

  const expenseTotal = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount_usd), 0);
  const unpaidTotal = (expenses ?? []).filter((e) => e.payment_status === 'unpaid').reduce((sum, e) => sum + Number(e.amount_usd), 0);
  const byCategoryMap = new Map<string, number>();
  for (const e of expenses ?? []) byCategoryMap.set(e.category, (byCategoryMap.get(e.category) ?? 0) + Number(e.amount_usd));
  const expenseByCategory = Array.from(byCategoryMap.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const laborByStaffMap = new Map<string, { staffName: string; minutes: number }>();
  for (const t of ownTimecards) {
    const s = staffById.get(t.staff_id as string);
    if (!s) continue;
    const minutes = applyTimecardRounding(workedMinutes(t.clock_in as string, t.clock_out as string | null, (t.breaks ?? []) as { startedAt: string; endedAt: string | null }[]), rounding);
    const prev = laborByStaffMap.get(s.id) ?? { staffName: s.display_name, minutes: 0 };
    prev.minutes += minutes;
    laborByStaffMap.set(s.id, prev);
  }
  let laborCostTotal = 0;
  let laborHoursTotal = 0;
  const laborByStaff = Array.from(laborByStaffMap.entries()).map(([staffId, v]) => {
    const wage = staffById.get(staffId)?.hourly_wage_usd ?? null;
    const hours = v.minutes / 60;
    const cost = wage ? hours * wage : 0;
    laborHoursTotal += hours;
    laborCostTotal += cost;
    return { staffName: v.staffName, hours, cost };
  });

  return { from, to, expenseTotal, expenseByCategory, unpaidTotal, laborCostTotal, laborHoursTotal, laborByStaff: laborByStaff.sort((a, b) => b.cost - a.cost) };
}

function buildPrompt(storeName: string, current: PeriodSummary, previous: PeriodSummary): string {
  return `あなたはカンボジアの飲食店「${storeName}」の経営分析アシスタントです。以下は同店のPOSシステムから集計した経費・人件費データです。日本語で、経営者が読んですぐ役立つ分析と提案を書いてください。数字は与えられたデータの範囲でのみ言及し、憶測で新しい数字を作らないでください。断定しすぎず、「〜の可能性があります」等の表現も使ってください。

【対象期間】${current.from} 〜 ${current.to}
【比較期間 (直前の同じ日数)】${previous.from} 〜 ${previous.to}

■経費
対象期間合計: $${current.expenseTotal.toFixed(2)} (うち買掛未払い: $${current.unpaidTotal.toFixed(2)})
比較期間合計: $${previous.expenseTotal.toFixed(2)}
費目別内訳 (対象期間、上位10件):
${current.expenseByCategory.map((c) => `- ${c.category}: $${c.total.toFixed(2)}`).join('\n') || '(記録なし)'}

■人件費
対象期間 概算人件費合計: $${current.laborCostTotal.toFixed(2)} (実働 ${current.laborHoursTotal.toFixed(1)}時間)
比較期間 概算人件費合計: $${previous.laborCostTotal.toFixed(2)} (実働 ${previous.laborHoursTotal.toFixed(1)}時間)
スタッフ別 (対象期間、時給未設定のスタッフは人件費 $0 として表示されます):
${current.laborByStaff.map((s) => `- ${s.staffName}: ${s.hours.toFixed(1)}時間 / $${s.cost.toFixed(2)}`).join('\n') || '(記録なし)'}

上記を踏まえて、次の3つを出力してください:
1. summary: 全体の状況を2〜3文で要約
2. findings: 気づいた点・注意点を2〜4個 (箇条書きの各項目は1〜2文)
3. suggestions: 具体的な改善提案を2〜4個 (箇条書きの各項目は1〜2文、実行可能な内容にする)`;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'suggestions'],
};

async function callGemini(prompt: string): Promise<{ summary: string; findings: string[]; suggestions: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません (Vercelの環境変数に追加してください)');
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API呼び出しに失敗しました (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini APIから分析結果を取得できませんでした');
  const parsed = JSON.parse(text);
  return {
    summary: String(parsed.summary ?? ''),
    findings: Array.isArray(parsed.findings) ? parsed.findings.map(String) : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
  };
}

const postSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// 分析実行。manager 以上のみ (経費・勤怠のレポート閲覧と同じ権限)。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { from, to } = parsed.data;
  if (from > to) return NextResponse.json({ error: '開始日は終了日より前にしてください' }, { status: 400 });

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle();
  const storeName = store?.name ?? '当店';

  const rounding = await getRoundingSettings(supabase, storeId);

  const spanDays = daysBetweenInclusive(from, to);
  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(prevTo, -(spanDays - 1));

  try {
    const [current, previous] = await Promise.all([summarizePeriod(supabase, storeId, from, to, rounding), summarizePeriod(supabase, storeId, prevFrom, prevTo, rounding)]);

    if (current.expenseByCategory.length === 0 && current.laborByStaff.length === 0) {
      return NextResponse.json({ error: 'この期間には経費・勤怠の記録がありません' }, { status: 400 });
    }

    const prompt = buildPrompt(storeName, current, previous);
    const result = await callGemini(prompt);
    return NextResponse.json({ ...result, current, previous });
  } catch (err) {
    const message = err instanceof Error ? err.message : '分析の生成に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
