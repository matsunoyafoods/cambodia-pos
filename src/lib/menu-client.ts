/**
 * POS ネイティブ・メニュー管理 (設定画面「メニュー・商品オプション」タブ用) の
 * 同一オリジン API クライアント。staff-client.ts と同じ方針。
 */

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

export type PosMenuCategory = { id: string; name: string; sort_order: number; parent_id: string | null };

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
};

export type PosMenuOptionGroup = {
  id: string;
  key: string;
  label: string;
  required: boolean;
  sort_order: number;
  choices: PosMenuOptionChoice[];
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
