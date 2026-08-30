/**
 * 卓の滞在タイマー・飲み放題タイマー用、公開 (認証なし) API クライアント。
 * /api/pos-order/table-sessions は withPosStaff を使わない (理由は pos-order-client.ts と同じ)。
 */

export class TableSessionApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'TableSessionApiError';
  }
}

export type TableSessionRecord = {
  table_code: string;
  started_at: string;
  drink_timer_started_at: string | null;
  drink_timer_minutes: number;
};

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
    throw new TableSessionApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export function getTableSessions(): Promise<{ items: TableSessionRecord[] }> {
  return request('/api/pos-order/table-sessions');
}

function post(body: { tableCode: string; action: 'start_stay' | 'start_drink' | 'extend_drink' | 'clear'; drinkMinutes?: number }) {
  return request<{ ok: true }>('/api/pos-order/table-sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function startTableStay(tableCode: string) {
  return post({ tableCode, action: 'start_stay' });
}

export function startDrinkTimer(tableCode: string, minutes = 60) {
  return post({ tableCode, action: 'start_drink', drinkMinutes: minutes });
}

export function extendDrinkTimer(tableCode: string, minutes = 30) {
  return post({ tableCode, action: 'extend_drink', drinkMinutes: minutes });
}

export function clearTableSession(tableCode: string) {
  return post({ tableCode, action: 'clear' });
}
