/**
 * 売上レポート (/pos/sales-report) の同一オリジン API クライアント (2026-09-02 追加)。
 */

import type { EthnicityKey, TimePeriod } from '@/lib/pos-types';

export class PosSalesReportApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosSalesReportApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new PosSalesReportApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export type EthnicityTotal = { key: EthnicityKey; label: string; count: number };

export type TimePeriodSales = { id: string; label: string; labelEn?: string; labelKm?: string; start: string; end: string; total: number; orderCount: number };

export type DailySalesDay = {
  date: string;
  total: number;
  orderCount: number;
  guestCount: number;
  partyCount: number;
  ethnicityTotals: EthnicityTotal[];
  timePeriodSales: TimePeriodSales[];
};

export type DailySales = {
  month: string;
  days: DailySalesDay[];
  monthTotal: number;
  orderCount: number;
  guestCount: number;
  partyCount: number;
  ethnicityTotals: EthnicityTotal[];
  timePeriodSales: TimePeriodSales[];
  timePeriods: TimePeriod[];
};

export function getDailySales(month: string): Promise<DailySales> {
  return request(`/api/sales-report/daily?month=${encodeURIComponent(month)}`);
}

// 本日の売上 (2026-09-04 追加。レジ画面ヘッダーの常時表示用)。
export type TodaySales = {
  date: string;
  total: number;
  orderCount: number;
  guestCount: number;
  partyCount: number;
  ethnicityTotals: EthnicityTotal[];
  timePeriodSales: TimePeriodSales[];
};

export function getTodaySales(): Promise<TodaySales> {
  return request('/api/sales-report/today');
}

export type TableSaleRow = {
  orderId: string;
  date: string;
  tableCode: string;
  total: number;
  ethnicity: { label: string; count: number }[];
  kidsCount: number;
  partySize: number;
  unitPrice: number | null;
  /** 決済方法名 (通常1件。分割払いの場合は複数件になる) (2026-10-17 追加) */
  paymentMethods: string[];
  /** 支払いラインがちょうど1本で、決済方法を修正できる会計かどうか (2026-10-17 追加) */
  paymentMethodEditable: boolean;
};

export type PaymentMethodTotal = { method: string; total: number };

export type TableSalesReport = {
  month: string;
  rows: TableSaleRow[];
  /** 月間の決済方法別合計 (2026-10-17 追加。Tom「売上レポートに支払い別の合計を出して
   * ほしいです」への対応) */
  paymentMethodTotals: PaymentMethodTotal[];
};

export function getTableSalesReport(month: string): Promise<TableSalesReport> {
  return request(`/api/sales-report/tables?month=${encodeURIComponent(month)}`);
}

// 決済方法の遡及修正 (2026-10-17 追加)。
export function updateOrderPaymentMethod(orderId: string, method: string): Promise<{ ok: true; method: string }> {
  return request(`/api/orders/${encodeURIComponent(orderId)}/payment-method`, {
    method: 'PATCH',
    body: JSON.stringify({ method }),
  });
}

// 会計取消 (2026-09-20 追加)。Tom「会計を間違えて後から訂正する」への対応。

export function voidOrder(orderId: string, reason?: string): Promise<{ ok: true }> {
  return request(`/api/orders/${encodeURIComponent(orderId)}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export type VoidLogRow = {
  id: string;
  orderId: string;
  tableCode: string;
  voidedTotal: number;
  reason: string | null;
  voidedByName: string | null;
  voidedAt: string;
};

export type VoidHistory = {
  month: string;
  rows: VoidLogRow[];
};

export function getVoidHistory(month: string): Promise<VoidHistory> {
  return request(`/api/orders/void-history?month=${encodeURIComponent(month)}`);
}
