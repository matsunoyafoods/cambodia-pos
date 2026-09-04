import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { MenuLang } from '@/lib/pos-types';

// メニュー多言語化 (2026-09-02 追加)。Tom「多言語化しましょう！日本語、英語、カンボジア語、
// 中国語、韓国語が必要です」への対応。カテゴリー・商品・オプショングループ・オプション選択肢の
// 4テーブルに追加した translations (jsonb) 列を、設定画面「翻訳」タブから横断的に一覧・編集するための
// フラットなAPI。個々のテーブルのCRUD (menu-client.ts) とは別に、翻訳作業だけに特化させている。

export type TranslationEntryType =
  | 'category'
  | 'item'
  | 'option_group'
  | 'option_choice'
  | 'option_template'
  | 'option_template_choice';

export type TranslationEntry = {
  type: TranslationEntryType;
  id: string;
  ja: string;
  /** 一覧で親子関係が分かるようにするための補足 (商品名・カテゴリー名など) */
  context: string | null;
  translations: Partial<Record<MenuLang, string>>;
};

async function loadEntries(storeId: string): Promise<TranslationEntry[]> {
  const supabase = createPosAdminClient();

  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from('menu_categories').select('id, name, translations').eq('store_id', storeId),
    supabase.from('menu_items').select('id, name, translations, category_id').eq('store_id', storeId).order('sort_order'),
  ]);

  const categoryById = new Map((categories ?? []).map((c) => [c.id, c.name as string]));
  const itemNameById = new Map((items ?? []).map((it) => [it.id, it.name as string]));
  const itemIds = (items ?? []).map((it) => it.id as string);

  const entries: TranslationEntry[] = [];

  for (const c of categories ?? []) {
    entries.push({ type: 'category', id: c.id, ja: c.name, context: null, translations: (c.translations as Record<string, string>) ?? {} });
  }

  for (const it of items ?? []) {
    const catName = it.category_id ? (categoryById.get(it.category_id) ?? null) : null;
    entries.push({ type: 'item', id: it.id, ja: it.name, context: catName, translations: (it.translations as Record<string, string>) ?? {} });
  }

  if (itemIds.length > 0) {
    const { data: groups } = await supabase
      .from('menu_option_groups')
      .select('id, label, translations, menu_id, menu_option_choices ( id, label, translations, sort_order )')
      .in('menu_id', itemIds);

    type GroupRow = {
      id: string;
      label: string;
      translations: Record<string, string> | null;
      menu_id: string;
      menu_option_choices: { id: string; label: string; translations: Record<string, string> | null; sort_order: number }[];
    };

    for (const g of (groups ?? []) as unknown as GroupRow[]) {
      const itemName = itemNameById.get(g.menu_id) ?? null;
      entries.push({ type: 'option_group', id: g.id, ja: g.label, context: itemName, translations: g.translations ?? {} });
      for (const choice of (g.menu_option_choices ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)) {
        entries.push({
          type: 'option_choice',
          id: choice.id,
          ja: choice.label,
          context: itemName ? `${itemName} / ${g.label}` : g.label,
          translations: choice.translations ?? {},
        });
      }
    }
  }

  // オプションテンプレート (「ライスorパン」等、複数商品で使い回すひな形。商品ごとの実データとは
  // 別テーブル。2026-09-04追加、Tom「オプションが翻訳されていない」への対応)。store_id で絞り込む。
  const { data: templates } = await supabase
    .from('menu_option_group_templates')
    .select('id, label, translations, menu_option_choice_templates ( id, label, translations, sort_order )')
    .eq('store_id', storeId);

  type TemplateRow = {
    id: string;
    label: string;
    translations: Record<string, string> | null;
    menu_option_choice_templates: { id: string; label: string; translations: Record<string, string> | null; sort_order: number }[];
  };

  for (const tpl of (templates ?? []) as unknown as TemplateRow[]) {
    entries.push({ type: 'option_template', id: tpl.id, ja: tpl.label, context: null, translations: tpl.translations ?? {} });
    for (const choice of (tpl.menu_option_choice_templates ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)) {
      entries.push({
        type: 'option_template_choice',
        id: choice.id,
        ja: choice.label,
        context: tpl.label,
        translations: choice.translations ?? {},
      });
    }
  }

  return entries;
}

// 一覧取得。manager以上 (メニュー管理と同じ権限)。
export const GET = withPosStaff('manager', async () => {
  const storeId = getPosStoreId();
  const entries = await loadEntries(storeId);
  return NextResponse.json({ entries });
});

const TABLE_BY_TYPE: Record<TranslationEntryType, string> = {
  category: 'menu_categories',
  item: 'menu_items',
  option_group: 'menu_option_groups',
  option_choice: 'menu_option_choices',
  option_template: 'menu_option_group_templates',
  option_template_choice: 'menu_option_choice_templates',
};

const patchSchema = z.object({
  type: z.enum(['category', 'item', 'option_group', 'option_choice', 'option_template', 'option_template_choice']),
  id: z.string().uuid(),
  translations: z.object({
    en: z.string().optional(),
    km: z.string().optional(),
    zh: z.string().optional(),
    ko: z.string().optional(),
  }),
});

// 1件保存 (設定画面での手動編集用)。manager以上。
export const PATCH = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { type, id, translations } = parsed.data;
  const supabase = createPosAdminClient();
  const table = TABLE_BY_TYPE[type];

  // translations は空文字のキーを保存しない (未翻訳=キー無し、として扱う)
  const cleaned: Record<string, string> = {};
  for (const [lang, value] of Object.entries(translations)) {
    if (value && value.trim()) cleaned[lang] = value.trim();
  }

  const { error } = await supabase.from(table).update({ translations: cleaned }).eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
