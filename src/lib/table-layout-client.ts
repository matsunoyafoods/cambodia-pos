/**
 * POS ネイティブ・テーブルレイアウト管理 (設定画面「テーブルレイアウト」タブ用) の
 * 同一オリジン API クライアント。menu-client.ts と同じ方針。
 */

export class PosTableLayoutApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosTableLayoutApiError';
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
    throw new PosTableLayoutApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type TableLayoutKind = 'table' | 'pillar' | 'counter' | 'wall';

export type TableLayoutItemRecord = {
  id: string;
  table_code: string;
  kind: TableLayoutKind;
  seats: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sort_order: number;
  /** 複数階対応 (2026-11-06)。null = 先頭の階 (階が無い店舗は従来の1枚レイアウト)。 */
  floor_id: string | null;
};

/** テーブルレイアウトの階 (フロア)。0件の店舗は従来通りの1枚レイアウト。 */
export type TableFloorRecord = {
  id: string;
  name: string;
  sort_order: number;
};

export function listTableLayout(): Promise<{ items: TableLayoutItemRecord[]; floors: TableFloorRecord[] }> {
  return request('/api/table-layout');
}

/**
 * 階を追加する。階が1件も無い店舗では、サーバー側で先に defaultFloorName の階を作り、
 * 既存の卓 (floor_id = null) を全部そこへ入れてから新しい階を作る (返り値の defaultFloor)。
 */
export function createTableFloor(input: {
  name: string;
  defaultFloorName?: string;
}): Promise<{ floor: TableFloorRecord; defaultFloor: TableFloorRecord | null }> {
  return request('/api/table-floors', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTableFloor(
  id: string,
  patch: Partial<{ name: string; sortOrder: number }>,
): Promise<{ floor: TableFloorRecord }> {
  return request(`/api/table-floors/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteTableFloor(id: string): Promise<{ ok: boolean }> {
  return request(`/api/table-floors/${id}`, { method: 'DELETE' });
}

export function createTableLayoutItem(input: {
  tableCode: string;
  kind?: TableLayoutKind;
  seats?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  floorId?: string | null;
}): Promise<{ item: TableLayoutItemRecord }> {
  return request('/api/table-layout', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTableLayoutItem(
  id: string,
  patch: Partial<{
    tableCode: string;
    kind: TableLayoutKind;
    seats: number;
    x: number;
    y: number;
    width: number;
    height: number;
    sortOrder: number;
    floorId: string | null;
  }>,
): Promise<{ item: TableLayoutItemRecord }> {
  return request(`/api/table-layout/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteTableLayoutItem(id: string): Promise<{ ok: boolean }> {
  return request(`/api/table-layout/${id}`, { method: 'DELETE' });
}
