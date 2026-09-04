/**
 * POS ネイティブ・メニュー管理 (設定画面「メニュー・商品オプション」タブ用) の
 * 同一オリジン API クライアント。staff-client.ts と同じ方針。
 */

import type { TranslationMap } from '@/lib/pos-types';

export class PosMenuApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosMenuApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new PosMenuApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type PosMenuCategory = {
  id: string;
  name: string;
  sort_order: number;
  parent_id: string | null;
  /** 翻訳タブで入力済みの多言語名 (2026-09-03 追加。カテゴリーツリーの表示言語切り替えに使う。
   * 並び替え・検索・リネーム入力など内部ロジックは従来通り日本語の name を使う) */
  translations?: TranslationMap;
  /** フード/ドリンク区分 (2026-09-04 追加)。ドリンクに設定すると、配下の商品はキッチンモニター
   * ではなくドリンカーモニターに表示される。既存カテゴリーは全て 'food' (デフォルト)。 */
  kind: 'food' | 'drink';
};

export type PosMenuItemRecord = {
  id: string;
  category_id: string | null;
  name: string;
  price: number;
  /** ハッピーアワー中だけ適用される価格。null/未設定 = ハッピーアワー対象外 */
  happy_hour_price: number | null;
  active: boolean;
  sort_order: number;
  image_url: string | null;
  /** 翻訳タブで入力済みの多言語名 (2026-09-03 追加。商品一覧の表示言語切り替えに使う) */
  translations?: TranslationMap;
};

export function listMenuCategories(): Promise<{ categories: PosMenuCategory[] }> {
  return request('/api/menu/categories');
}

export function createMenuCategory(name: string, parentId: string | null = null): Promise<{ category: PosMenuCategory }> {
  return request('/api/menu/categories', { method: 'POST', body: JSON.stringify({ name, parentId }) });
}

export function renameMenuCategory(id: string, name: string): Promise<{ category: PosMenuCategory }> {
  return request(`/api/menu/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function reparentMenuCategory(id: string, parentId: string | null): Promise<{ category: PosMenuCategory }> {
  return request(`/api/menu/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ parentId }) });
}

export function reorderMenuCategory(id: string, sortOrder: number): Promise<{ category: PosMenuCategory }> {
  return request(`/api/menu/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ sortOrder }) });
}

// フード/ドリンク区分の切り替え (2026-09-04 追加)。
export function setMenuCategoryKind(id: string, kind: 'food' | 'drink'): Promise<{ category: PosMenuCategory }> {
  return request(`/api/menu/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ kind }) });
}

export function deleteMenuCategory(id: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/categories/${id}`, { method: 'DELETE' });
}

export function listMenuItems(): Promise<{ items: PosMenuItemRecord[] }> {
  return request('/api/menu/items');
}

export function createMenuItem(input: {
  categoryId: string | null;
  name: string;
  price: number;
  happyHourPrice?: number | null;
}): Promise<{
  item: PosMenuItemRecord;
}> {
  return request('/api/menu/items', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMenuItem(
  id: string,
  patch: Partial<{ categoryId: string | null; name: string; price: number; active: boolean; happyHourPrice: number | null }>,
): Promise<{ item: PosMenuItemRecord }> {
  return request(`/api/menu/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteMenuItem(id: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/items/${id}`, { method: 'DELETE' });
}

export async function uploadMenuItemImage(id: string, file: File): Promise<{ item: PosMenuItemRecord }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/menu/items/${id}/image`, { method: 'POST', body: form });
  if (!res.ok) {
    let message = `アップロードに失敗しました (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new PosMenuApiError(message, res.status);
  }
  return res.json() as Promise<{ item: PosMenuItemRecord }>;
}

export function deleteMenuItemImage(id: string): Promise<{ item: PosMenuItemRecord }> {
  return request(`/api/menu/items/${id}/image`, { method: 'DELETE' });
}

export type PosMenuOptionChoice = {
  id: string;
  group_id: string;
  choice_key: string;
  label: string;
  price_delta: number;
  sort_order: number;
  /** 翻訳タブで入力済みの多言語名 (2026-09-04 追加。表示のみに使用、編集は従来通り日本語の label) */
  translations?: TranslationMap;
};

export type PosMenuOptionGroup = {
  id: string;
  key: string;
  label: string;
  required: boolean;
  sort_order: number;
  choices: PosMenuOptionChoice[];
  /** 翻訳タブで入力済みの多言語名 (2026-09-04 追加。表示のみに使用、編集は従来通り日本語の label) */
  translations?: TranslationMap;
};

export function listMenuOptionGroups(itemId: string): Promise<{ groups: PosMenuOptionGroup[] }> {
  return request(`/api/menu/items/${itemId}/option-groups`);
}

export function createMenuOptionGroup(
  itemId: string,
  input: { key: string; label: string; required?: boolean },
): Promise<{ group: PosMenuOptionGroup }> {
  return request(`/api/menu/items/${itemId}/option-groups`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateMenuOptionGroup(
  itemId: string,
  groupId: string,
  patch: Partial<{ label: string; required: boolean; sortOrder: number }>,
): Promise<{ group: Omit<PosMenuOptionGroup, 'choices'> }> {
  return request(`/api/menu/items/${itemId}/option-groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteMenuOptionGroup(itemId: string, groupId: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/items/${itemId}/option-groups/${groupId}`, { method: 'DELETE' });
}

export function createMenuOptionChoice(
  itemId: string,
  groupId: string,
  input: { choiceKey: string; label: string; priceDelta?: number },
): Promise<{ choice: PosMenuOptionChoice }> {
  return request(`/api/menu/items/${itemId}/option-groups/${groupId}/choices`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateMenuOptionChoice(
  itemId: string,
  groupId: string,
  choiceId: string,
  patch: Partial<{ label: string; priceDelta: number; sortOrder: number }>,
): Promise<{ choice: PosMenuOptionChoice }> {
  return request(`/api/menu/items/${itemId}/option-groups/${groupId}/choices/${choiceId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteMenuOptionChoice(itemId: string, groupId: string, choiceId: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/items/${itemId}/option-groups/${groupId}/choices/${choiceId}`, { method: 'DELETE' });
}

// ---------- オプションテンプレート (「ライスorパン」「ドリンク選択」など、複数商品で使い回す ひな形) ----------
// 商品ごとの実データ (PosMenuOptionGroup/PosMenuOptionChoice) とは別物。テンプレートを商品に
// 適用すると、内容をコピーした PosMenuOptionGroup が新規作成される (参照ではなくコピー)。

export type PosMenuOptionChoiceTemplate = {
  id: string;
  template_id: string;
  choice_key: string;
  label: string;
  price_delta: number;
  sort_order: number;
  /** 翻訳タブで入力済みの多言語名 (2026-09-04 追加。表示のみに使用、編集は従来通り日本語の label) */
  translations?: TranslationMap;
};

export type PosMenuOptionGroupTemplate = {
  id: string;
  key: string;
  label: string;
  required: boolean;
  sort_order: number;
  choices: PosMenuOptionChoiceTemplate[];
  /** 翻訳タブで入力済みの多言語名 (2026-09-04 追加。表示のみに使用、編集は従来通り日本語の label) */
  translations?: TranslationMap;
};

export function listMenuOptionTemplates(): Promise<{ templates: PosMenuOptionGroupTemplate[] }> {
  return request('/api/menu/option-templates');
}

export function createMenuOptionTemplate(input: {
  key: string;
  label: string;
  required?: boolean;
}): Promise<{ template: PosMenuOptionGroupTemplate }> {
  return request('/api/menu/option-templates', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMenuOptionTemplate(
  templateId: string,
  patch: Partial<{ label: string; required: boolean; sortOrder: number }>,
): Promise<{ template: Omit<PosMenuOptionGroupTemplate, 'choices'> }> {
  return request(`/api/menu/option-templates/${templateId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteMenuOptionTemplate(templateId: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/option-templates/${templateId}`, { method: 'DELETE' });
}

export function createMenuOptionTemplateChoice(
  templateId: string,
  input: { choiceKey: string; label: string; priceDelta?: number },
): Promise<{ choice: PosMenuOptionChoiceTemplate }> {
  return request(`/api/menu/option-templates/${templateId}/choices`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateMenuOptionTemplateChoice(
  templateId: string,
  choiceId: string,
  patch: Partial<{ label: string; priceDelta: number; sortOrder: number }>,
): Promise<{ choice: PosMenuOptionChoiceTemplate }> {
  return request(`/api/menu/option-templates/${templateId}/choices/${choiceId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteMenuOptionTemplateChoice(templateId: string, choiceId: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/option-templates/${templateId}/choices/${choiceId}`, { method: 'DELETE' });
}

// 保存済みテンプレートを商品に適用する (内容をコピーして新規オプショングループを作成)。
export function applyMenuOptionTemplate(itemId: string, templateId: string): Promise<{ group: PosMenuOptionGroup }> {
  return request(`/api/menu/items/${itemId}/option-groups/apply-template`, {
    method: 'POST',
    body: JSON.stringify({ templateId }),
  });
}

// ---------- 多言語化 (2026-09-02 追加): カテゴリー・商品・オプション名の翻訳管理 ----------

export type MenuTranslationLang = 'en' | 'km' | 'zh' | 'ko';
export type MenuTranslationEntryType =
  | 'category'
  | 'item'
  | 'option_group'
  | 'option_choice'
  | 'option_template'
  | 'option_template_choice';

export type MenuTranslationEntry = {
  type: MenuTranslationEntryType;
  id: string;
  ja: string;
  context: string | null;
  translations: Partial<Record<MenuTranslationLang, string>>;
};

export function listMenuTranslations(): Promise<{ entries: MenuTranslationEntry[] }> {
  return request('/api/menu/translations');
}

export function saveMenuTranslation(
  type: MenuTranslationEntryType,
  id: string,
  translations: Partial<Record<MenuTranslationLang, string>>,
): Promise<{ ok: boolean }> {
  return request('/api/menu/translations', { method: 'PATCH', body: JSON.stringify({ type, id, translations }) });
}

export function generateMenuTranslationDrafts(): Promise<{ updated: number; total: number }> {
  return request('/api/menu/translations/generate', { method: 'POST' });
}
