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

export type PosMenuCategory = { id: string; name: string; sort_order: number };

export type PosMenuItemRecord = {
  id: string;
  category_id: string | null;
  name: string;
  price: number;
  active: boolean;
  sort_order: number;
};

export function listMenuCategories(): Promise<{ categories: PosMenuCategory[] }> {
  return request('/api/menu/categories');
}

export function createMenuCategory(name: string): Promise<{ category: PosMenuCategory }> {
  return request('/api/menu/categories', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameMenuCategory(id: string, name: string): Promise<{ category: PosMenuCategory }> {
  return request(`/api/menu/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function deleteMenuCategory(id: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/categories/${id}`, { method: 'DELETE' });
}

export function listMenuItems(): Promise<{ items: PosMenuItemRecord[] }> {
  return request('/api/menu/items');
}

export function createMenuItem(input: { categoryId: string | null; name: string; price: number }): Promise<{
  item: PosMenuItemRecord;
}> {
  return request('/api/menu/items', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMenuItem(
  id: string,
  patch: Partial<{ categoryId: string | null; name: string; price: number; active: boolean }>,
): Promise<{ item: PosMenuItemRecord }> {
  return request(`/api/menu/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteMenuItem(id: string): Promise<{ ok: boolean }> {
  return request(`/api/menu/items/${id}`, { method: 'DELETE' });
}
