/**
 * 売上レポート (/pos/sales-report) の同一オリジン API クライアント (2026-09-02 追加)。
 */

export class PosSalesReportApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosSalesReportApiError';
  }
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path);
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

export type DailySales = {
  month: string;
  days: { date: string; total: number; orderCount: number }[];
  monthTotal: number;
  orderCount: number;
};

export function getDailySales(month: string): Promise<DailySales> {
  return request(`/api/sales-report/daily?month=${encodeURIComponent(month)}`);
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
};

export type TableSalesReport = {
  month: string;
  rows: TableSaleRow[];
};

export function getTableSalesReport(month: string): Promise<TableSalesReport> {
  return request(`/api/sales-report/tables?month=${encodeURIComponent(month)}`);
}
