import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { HandyTableGroup, MenuLang } from '@/lib/pos-types';

// ハンディ表示タブの卓グループ名、AI下書き生成 (2026-09-03 追加。Tom「AIで下書き生成もできる
// ようにしてほしい」)。/api/menu/translations/generate と同じ Gemini API 呼び出しパターンを
// 踏襲しつつ、対象データが専用テーブルの行ではなく pos.stores.settings.handyTableGroups
// (jsonb配列) である点だけが異なる。既に翻訳が入っている言語は上書きしない (Tomが手直しした
// 内容を消さないため) — 空欄の言語だけを埋める。

type StoredSettings = { handyTableGroups?: HandyTableGroup[] };

const LANGS: MenuLang[] = ['en', 'km', 'zh', 'ko'];
const LANG_NAME: Record<MenuLang, string> = { en: '英語', km: 'クメール語 (カンボジア語)', zh: '簡体字中国語', ko: '韓国語' };

async function callGeminiBatch(texts: { key: string; ja: string }[]): Promise<Record<string, Partial<Record<MenuLang, string>>>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません (Vercelの環境変数に追加してください)');
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const prompt = `あなたはカンボジアの飲食店のPOSシステムの翻訳者です。以下は日本語の卓グループ名 (ハンディ注文画面で卓を分類するための見出し。例: 「カウンター」「個室」) のリストです。各項目について、英語・${LANG_NAME.km}・${LANG_NAME.zh}・${LANG_NAME.ko}への自然な短い訳を作ってください。飲食店の卓案内として自然な表現にし、直訳しすぎないでください。

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
  const supabase = createPosAdminClient();

  const { data: existing, error: readError } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const stored = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as StoredSettings;
  const groups = stored.handyTableGroups ?? [];

  const targets = groups
    .map((g, idx) => ({ idx, g }))
    .filter(({ g }) => LANGS.some((l) => !g.translations?.[l] || !g.translations[l]!.trim()));

  if (targets.length === 0) {
    return NextResponse.json({ updated: 0, total: 0 });
  }

  const texts = targets.map(({ idx, g }) => ({ key: String(idx), ja: g.name }));
  let translated: Record<string, Partial<Record<MenuLang, string>>>;
  try {
    translated = await callGeminiBatch(texts);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI翻訳に失敗しました', updated: 0 }, { status: 502 });
  }

  let updated = 0;
  const nextGroups = groups.map((g, idx) => {
    const draft = translated[String(idx)];
    if (!draft) return g;
    const merged = { ...(g.translations ?? {}) };
    let changed = false;
    for (const lang of LANGS) {
      if ((!merged[lang] || !merged[lang]!.trim()) && draft[lang] && draft[lang]!.trim()) {
        merged[lang] = draft[lang]!.trim();
        changed = true;
      }
    }
    if (changed) updated += 1;
    return { ...g, translations: merged };
  });

  const current = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as Record<string, unknown>;
  const merged = { ...current, handyTableGroups: nextGroups };
  const { error } = await supabase.from('stores').update({ settings: merged, updated_at: new Date().toISOString() }).eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ updated, total: targets.length, groups: nextGroups });
});
