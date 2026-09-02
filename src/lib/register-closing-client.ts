/**
 * レジ締めの同一オリジン API クライアント (2026-09-02 実データ連携)。
 */

export class PosRegisterClosingApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosRegisterClosingApiError';
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
    throw new PosRegisterClosingApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type RegisterClosingRecord = {
  id: string;
  date: string;
  shift: string | null;
  systemCashTotal: number;
  systemTotalsByMethod: Record<string, number>;
  countedUsdBills: Record<string, number>;
  countedKhrBills: Record<string, number>;
  countedTotalUsd: number;
  differenceUsd: number;
  confirmedByName: string | null;
  confirmedAt: string;
};

export type RegisterClosingStatus =
  | { confirmed: true; closing: RegisterClosingRecord }
  | { confirmed: false; systemCashTotal: number; systemTotalsByMethod: Record<string, number>; salesTotal: number };

export function getRegisterClosingStatus(date: string): Promise<RegisterClosingStatus> {
  return request(`/api/register-closings?date=${encodeURIComponent(date)}`);
}

export function confirmRegisterClosing(input: {
  date: string;
  shift?: string;
  countedUsdBills: Record<number, number>;
  countedKhrBills: Record<number, number>;
}): Promise<{ closing: RegisterClosingRecord }> {
  return request('/api/register-closings', {
    method: 'POST',
    body: JSON.stringify({
      date: input.date,
      shift: input.shift,
      countedUsdBills: Object.fromEntries(Object.entries(input.countedUsdBills).map(([k, v]) => [String(k), v])),
      countedKhrBills: Object.fromEntries(Object.entries(input.countedKhrBills).map(([k, v]) => [String(k), v])),
    }),
  });
}

// 確定済みレジ締めの削除 (manager以上。実査ミス等でやり直したい場合)。
export async function deleteRegisterClosing(id: string): Promise<void> {
  await request(`/api/register-closings/${id}`, { method: 'DELETE' });
}
