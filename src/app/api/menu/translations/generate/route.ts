import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { MenuLang } from '@/lib/pos-types';

// メニュー翻訳のAI下書き生成 (2026-09-02 追加)。Gemini APIで日本語のカテゴリー名・商品名・
// オプション名を英語・クメール語・中国語・韓国語へ一括で下書き翻訳する。既に翻訳が入っている
// 言語は上書きしない (Tomが手直しした内容を消さないため) — 空欄の言語だけを埋める。
// /api/analysis/insights と同じ Gemini API 呼び出しパターンを踏襲。

const TABLE_BY_TYPE: Record<string, string> = {
  category: 'menu_categories',
  item: 'menu_items',
  option_group: 'menu_option_groups',
  option_choice: 'menu_option_choices',
  option_template: 'menu_option_group_templates',
  option_template_choice: 'menu_option_choice_templates',
};

type RawRow = { id: string; ja: string; translations: Record<string, string> | null };

async function fetchUntranslated(storeId: string): Promise<Record<string, RawRow[]>> {
  const supabase = createPosAdminClient();
  const result: Record<string, RawRow[]> = {
    category: [],
    item: [],
    option_group: [],
    option_choice: [],
    option_template: [],
    option_template_choice: [],
  };

  const { data: categories } = await supabase.from('menu_categories').select('id, name, translations').eq('store_id', storeId);
  result.category = (categories ?? []).map((c) => ({ id: c.id, ja: c.name, translations: c.translations as Record<string, string> | null }));

  const { data: items } = await supabase.from('menu_items').select('id, name, translations').eq('store_id', storeId);
  result.item = (items ?? []).map((it) => ({ id: it.id, ja: it.name, translations: it.translations as Record<string, string> | null }));

  const itemIds = (items ?? []).map((it) => it.id as string);
  if (itemIds.length > 0) {
    const { data: groups } = await supabase
      .from('menu_option_groups')
      .select('id, label, translations, menu_option_choices ( id, label, translations )')
      .in('menu_id', itemIds);
    type GroupRow = { id: string; label: string; translations: Record<string, string> | null; menu_option_choices: { id: string; label: string; translations: Record<string, string> | null }[] };
    for (const g of (groups ?? []) as unknown as GroupRow[]) {
      result.option_group.push({ id: g.id, ja: g.label, translations: g.translations });
      for (const c of g.menu_option_choices ?? []) {
        result.option_choice.push({ id: c.id, ja: c.label, translations: c.translations });
      }
    }
  }

  const { data: templates } = await supabase
    .from('menu_option_group_templates')
    .select('id, label, translations, menu_option_choice_templates ( id, label, translations )')
    .eq('store_id', storeId);
  type TemplateRow = {
    id: string;
    label: string;
    translations: Record<string, string> | null;
    menu_option_choice_templates: { id: string; label: string; translations: Record<string, string> | null }[];
  };
  for (const tpl of (templates ?? []) as unknown as TemplateRow[]) {
    result.option_template.push({ id: tpl.id, ja: tpl.label, translations: tpl.translations });
    for (const c of tpl.menu_option_choice_templates ?? []) {
      result.option_template_choice.push({ id: c.id, ja: c.label, translations: c.translations });
    }
  }

  return result;
}

const LANGS: MenuLang[] = ['en', 'km', 'zh', 'ko'];
const LANG_NAME: Record<MenuLang, string> = { en: '英語', km: 'クメール語 (カンボジア語)', zh: '簡体字中国語', ko: '韓国語' };

async function callGeminiBatch(texts: { key: string; ja: string }[]): Promise<Record<string, Partial<Record<MenuLang, string>>>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません (Vercelの環境変数に追加してください)');
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const prompt = `あなたはカンボジアの飲食店のメニュー翻訳者です。以下は日本語のメニュー項目 (カテゴリー名・商品名・オプション名) のリストです。各項目について、英語・${LANG_NAME.km}・${LANG_NAME.zh}・${LANG_NAME.ko}への自然な翻訳を作ってください。飲食店のメニューとして自然な表現にし、直訳しすぎないでください。固有名詞的な料理名 (すでにカタカナ英語のもの等) はそのまま/近い表記でよいです。

【項目一覧】(key: 日本語)
${texts.map((t) => `${t.key}: ${t.ja}`).join('\n')}

各keyについて en/km/zh/ko の4つの翻訳を出力してください。`;

  const responseSchema = {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            en: { type: 'string' },
            km: { type: 'string' },
            zh: { type: 'string' },
            ko: { type: 'string' },
          },
          required: ['key', 'en', 'km', 'zh', 'ko'],
        },
      },
    },
    required: ['translations'],
  };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API呼び出しに失敗しました (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini APIから翻訳結果を取得できませんでした');
  const parsed = JSON.parse(text);
  const arr = Array.isArray(parsed.translations) ? parsed.translations : [];
  const out: Record<string, Partial<Record<MenuLang, string>>> = {};
  for (const row of arr) {
    if (!row?.key) continue;
    out[String(row.key)] = {
      en: typeof row.en === 'string' ? row.en : undefined,
      km: typeof row.km === 'string' ? row.km : undefined,
      zh: typeof row.zh === 'string' ? row.zh : undefined,
      ko: typeof row.ko === 'string' ? row.ko : undefined,
    };
  }
  return out;
}

// AI下書き一括生成。manager以上。ボタン押下のオンデマンド実行のみ (自動実行はしない)。
export const POST = withPosStaff('manager', async () => {
  const storeId = getPosStoreId();
  const byType = await fetchUntranslated(storeId);
  const supabase = createPosAdminClient();

  // 4言語すべて揃っている行は翻訳対象から除外する (Gemini呼び出し・トークンの節約、
  // かつ既存の手直しを保護するため)。
  const targets: { type: string; id: string; ja: string; existing: Record<string, string> }[] = [];
  for (const type of Object.keys(byType)) {
    for (const row of byType[type]) {
      const existing = row.translations ?? {};
      const missing = LANGS.some((l) => !existing[l] || !existing[l].trim());
      if (missing) {
        targets.push({ type, id: row.id, ja: row.ja, existing });
      }
    }
  }

  if (targets.length === 0) {
    return NextResponse.json({ updated: 0, total: 0 });
  }

  // Gemini呼び出し1回あたりの項目数が多くなりすぎないよう、80件ずつに分割する。
  const CHUNK = 80;
  const chunks: typeof targets[] = [];
  for (let i = 0; i < targets.length; i += CHUNK) chunks.push(targets.slice(i, i + CHUNK));

  const keyOf = (t: (typeof targets)[number], idx: number) => `${t.type}:${idx}`;

  let updated = 0;
  for (const chunk of chunks) {
    const texts = chunk.map((t, idx) => ({ key: keyOf(t, idx), ja: t.ja }));
    let translated: Record<string, Partial<Record<MenuLang, string>>>;
    try {
      translated = await callGeminiBatch(texts);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'AI翻訳に失敗しました', updated }, { status: 502 });
    }

    for (let idx = 0; idx < chunk.length; idx += 1) {
      const t = chunk[idx];
      const key = keyOf(t, idx);
      const draft = translated[key];
      if (!draft) continue;
      const merged: Record<string, string> = { ...t.existing };
      for (const lang of LANGS) {
        if ((!merged[lang] || !merged[lang].trim()) && draft[lang] && draft[lang]!.trim()) {
          merged[lang] = draft[lang]!.trim();
        }
      }
      const table = TABLE_BY_TYPE[t.type];
      const { error } = await supabase.from(table).update({ translations: merged }).eq('id', t.id);
      if (!error) updated += 1;
    }
  }

  return NextResponse.json({ updated, total: targets.length });
});
