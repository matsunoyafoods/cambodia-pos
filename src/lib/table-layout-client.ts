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
};

export function listTableLayout(): Promise<{ items: TableLayoutItemRecord[] }> {
  return request('/api/table-layout');
}

export function createTableLayoutItem(input: {
  tableCode: string;
  kind?: TableLayoutKind;
  seats?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
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
  }>,
): Promise<{ item: TableLayoutItemRecord }> {
  return request(`/api/table-layout/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteTableLayoutItem(id: string): Promise<{ ok: boolean }> {
  return request(`/api/table-layout/${id}`, { method: 'DELETE' });
}
