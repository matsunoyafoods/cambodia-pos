import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { LANGS, type Lang } from '@/lib/i18n/lang';

// AI経営相談チャット (2026-10-07 追加)。Tom「この診断をもとにそのままAIとやり取りができる。
// AIは経営コンサルタントとして相談にのってくれるtalk機能」への対応 (AI分析・課題提案
// (/api/analysis/insights) の後継ではなく、期間を区切らない常設の相談チャット — Tom確認済み)。
//
// 店舗ごとに1本の継続した会話 (pos.advisor_messages、owner/manager共有、保存する)。
// 呼び出すたびに当月の経費・勤怠の概況を軽く取得してプロンプトに含めることで、Tomが毎回
// 数字を説明しなくてもある程度データに基づいた相談ができるようにする (ただし厳密な分析は
// 引き続き /pos/insights の「AI分析・課題提案」を使う想定。ここはあくまで会話形式の相談)。
// 分析結果の翻訳(2段階生成)はせず、Geminiへ直接「{言語}で答えて」と指示する方式にした
// (会話の自然さを優先。insights/route.ts の2段階翻訳とは別方式)。
//
// owner/manager限定 (deny sub_manager。他の経営データ系機能と同じ権限線引き)。

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

function currentMonthRangeUtc(): { startDate: string; endDate: string; monthLabel: string } {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit' }).format(now);
  const [y, m] = ymd.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { startDate: `${ymd}-01`, endDate: `${nextMonth}-01`, monthLabel: ymd };
}

async function buildBusinessContext(supabase: ReturnType<typeof createPosAdminClient>, storeId: string): Promise<string> {
  const { startDate, endDate, monthLabel } = currentMonthRangeUtc();
  const [{ data: expenses }, { data: closings }] = await Promise.all([
    supabase.from('expenses').select('amount_usd, category').eq('store_id', storeId).gte('date', startDate).lt('date', endDate),
    supabase.from('register_closings').select('date, system_cash_total').eq('store_id', storeId).gte('date', startDate).lt('date', endDate),
  ]);

  const expenseTotal = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount_usd), 0);
  const byCategoryMap = new Map<string, number>();
  for (const e of expenses ?? []) byCategoryMap.set(e.category, (byCategoryMap.get(e.category) ?? 0) + Number(e.amount_usd));
  const topCategories = Array.from(byCategoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, v]) => `${c}: $${v.toFixed(2)}`)
    .join('、');
  const salesTotal = (closings ?? []).reduce((sum, c) => sum + Number(c.system_cash_total), 0);

  return [
    `【今月 (${monthLabel}) の概況・参考情報】`,
    `レジ締め確定済みの売上合計: $${salesTotal.toFixed(2)} (${(closings ?? []).length}日分)`,
    `経費合計: $${expenseTotal.toFixed(2)}`,
    topCategories ? `経費の費目別内訳 (上位5件): ${topCategories}` : null,
    '※ 上記は参考情報であり、厳密な期間分析は別途「AI分析・課題提案」を使ってください。',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

const LANG_NAME: Record<Lang, string> = {
  ja: '日本語',
  en: '英語',
  km: 'クメール語 (カンボジア語)',
  zh: '簡体字中国語',
  ko: '韓国語',
};

async function callGeminiText(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません (Vercelの環境変数に追加してください)');
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API呼び出しに失敗しました (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini APIから返答を取得できませんでした');
  return text.trim();
}

type AdvisorMessageRow = { id: string; role: 'user' | 'assistant'; content: string; staff_name: string | null; created_at: string };

function toApi(row: AdvisorMessageRow) {
  return { id: row.id, role: row.role, content: row.content, staffName: row.staff_name, createdAt: row.created_at };
}

// GET: この店舗の会話履歴を取得 (直近200件)。
export const GET = withPosStaff(
  'manager',
  async (session) => {
    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();
    const { data, error } = await supabase
      .from('advisor_messages')
      .select('id, role, content, staff_name, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    void session;
    return NextResponse.json({ messages: (data as AdvisorMessageRow[] | null ?? []).map(toApi) });
  },
  { deny: ['sub_manager'] },
);

const postSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  lang: z.enum(LANGS as [Lang, ...Lang[]]).optional(),
});

// POST: ユーザー発言を保存 → 直近の会話履歴 + 当月概況をプロンプトに含めてGeminiへ送る
// → AI返信を保存して返す。
export const POST = withPosStaff(
  'manager',
  async (session, req) => {
    const json = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
    }
    const { message, lang } = parsed.data;

    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();

    const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle();

    const { data: userRow, error: insertUserError } = await supabase
      .from('advisor_messages')
      .insert({ store_id: storeId, role: 'user', content: message, staff_name: session.displayName })
      .select('id, role, content, staff_name, created_at')
      .single();
    if (insertUserError) return NextResponse.json({ error: insertUserError.message }, { status: 500 });

    const { data: historyRows, error: historyError } = await supabase
      .from('advisor_messages')
      .select('id, role, content, staff_name, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (historyError) return NextResponse.json({ error: historyError.message }, { status: 500 });
    const history = (historyRows as AdvisorMessageRow[] | null ?? []).slice().reverse();

    let businessContext = '';
    try {
      businessContext = await buildBusinessContext(supabase, storeId);
    } catch {
      businessContext = '';
    }

    const langName = LANG_NAME[lang ?? 'ja'];
    const transcript = history.map((h) => `${h.role === 'user' ? (h.staff_name ?? 'スタッフ') : 'AI'}: ${h.content}`).join('\n');

    const prompt = `あなたはカンボジアの飲食店「${store?.name ?? '当店'}」専属の経営コンサルタントAIです。店主・マネージャーからの経営相談に、親身かつ具体的に答えてください。断定しすぎず、必要に応じて「〜の可能性があります」等の表現も使ってください。数字は与えられたデータの範囲でのみ言及し、憶測で新しい数字を作らないでください。回答は${langName}で、2〜6文程度の自然な会話文にしてください (箇条書きを使う場合も簡潔に)。

${businessContext}

【これまでの会話】
${transcript || '(これが最初のメッセージです)'}

上記を踏まえて、直近のメッセージに${langName}で返答してください。`;

    let replyText: string;
    try {
      replyText = await callGeminiText(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '返答の生成に失敗しました';
      return NextResponse.json({ error: msg, userMessage: toApi(userRow as AdvisorMessageRow) }, { status: 500 });
    }

    const { data: assistantRow, error: insertAssistantError } = await supabase
      .from('advisor_messages')
      .insert({ store_id: storeId, role: 'assistant', content: replyText })
      .select('id, role, content, staff_name, created_at')
      .single();
    if (insertAssistantError) return NextResponse.json({ error: insertAssistantError.message }, { status: 500 });

    return NextResponse.json({
      userMessage: toApi(userRow as AdvisorMessageRow),
      assistantMessage: toApi(assistantRow as AdvisorMessageRow),
    });
  },
  { deny: ['sub_manager'] },
);
