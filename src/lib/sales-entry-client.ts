/**
 * 手入力売上 (/pos/sales-entry) の同一オリジン API クライアント (2026-09-24 追加)。
 * オーダー・会計機能を一時的に使わない間、日々の売上 (現金/カード/QR各種) を手入力で
 * 記録するための機能。pos.orders 由来の sales-report-client.ts とは別データ。
 */

import type { ManualDailySalesRecord, ManualSalesMethod } from './pos-types';

export class PosSalesEntryApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosSalesEntryApiError';
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
    throw new PosSalesEntryApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export type ManualSalesMonthTotals = Record<ManualSalesMethod, number>;

export type ManualDailySalesMonth = {
  month: string;
  days: ManualDailySalesRecord[];
  monthTotals: ManualSalesMonthTotals;
  grandTotal: number;
};

export function getManualDailySalesMonth(month: string): Promise<ManualDailySalesMonth> {
  return request(`/api/sales-entries?month=${encodeURIComponent(month)}`);
}

export function getManualDailySalesForDate(date: string): Promise<{ entry: ManualDailySalesRecord | null }> {
  return request(`/api/sales-entries?date=${encodeURIComponent(date)}`);
}

export type SaveManualDailySalesInput = {
  date: string;
  cashUsd: number;
  creditCardUsd: number;
  abaQrUsd: number;
  kbQrUsd: number;
  ppcbQrUsd: number;
  deliveryUsd: number;
  voucherUsd: number;
  note?: string;
};

export function saveManualDailySales(input: SaveManualDailySalesInput): Promise<{ entry: ManualDailySalesRecord }> {
  return request('/api/sales-entries', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteManualDailySales(id: string): Promise<{ ok: true }> {
  return request(`/api/sales-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
