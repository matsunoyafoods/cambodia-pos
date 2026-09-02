/**
 * 現金残高・銀行入金の同一オリジン API クライアント (2026-09-02 追加)。
 * Tom「レジの中に現金売上が貯まります。現金売上を銀行入金します。現金売上残高がいくらあるか
 * 分かるようにしたいです。」への対応。
 */

export class PosCashApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosCashApiError';
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
    throw new PosCashApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type CashBalance = {
  cashSalesTotal: number;
  bankDepositsTotal: number;
  cashExpensesTotal: number;
  balance: number;
  lastClosingDate: string | null;
};

export function getCashBalance(): Promise<CashBalance> {
  return request('/api/cash-balance');
}

export type CashDepositRecord = {
  id: string;
  date: string;
  amountUsd: number;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
};

export function listCashDeposits(filter?: { from?: string; to?: string }): Promise<CashDepositRecord[]> {
  const params = new URLSearchParams();
  if (filter?.from) params.set('from', filter.from);
  if (filter?.to) params.set('to', filter.to);
  const qs = params.toString();
  return request<{ deposits: CashDepositRecord[] }>(`/api/cash-deposits${qs ? `?${qs}` : ''}`).then((r) => r.deposits);
}

export async function createCashDeposit(input: { date: string; amountUsd: number; note?: string }): Promise<CashDepositRecord> {
  const { deposit } = await request<{ deposit: CashDepositRecord }>('/api/cash-deposits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return deposit;
}

export async function deleteCashDeposit(id: string): Promise<void> {
  await request(`/api/cash-deposits/${id}`, { method: 'DELETE' });
}
