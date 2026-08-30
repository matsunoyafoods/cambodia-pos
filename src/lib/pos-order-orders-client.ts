/**
 * レジ画面向け、卓の「開いている伝票 (pos.orders)」用の公開 (認証なし) API クライアント。
 * /api/pos-order/orders/* は withPosStaff を使わない (理由は pos-order-client.ts と同じ)。
 */

import type { CartLine, GuestEthnicity } from '@/lib/pos-types';

export class PosOrderOrdersApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosOrderOrdersApiError';
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
    throw new PosOrderOrdersApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type OpenOrderRecord = {
  id: string;
  table_code: string;
  status: 'open' | 'paid' | 'void';
  guest_ethnicity: GuestEthnicity;
  guest_kids_count: number;
  guest_recorded_at: string | null;
  created_at: string;
};

export type OrderItemRecord = {
  id: string;
  menu_id: string;
  menu_name: string;
  qty: number;
  unit_price: number;
  selected_options: CartLine['selectedOptions'];
  line_total: number;
  sent_to_kitchen_at: string | null;
};

export function getOpenOrder(tableCode: string): Promise<{ order: OpenOrderRecord | null; items: OrderItemRecord[] }> {
  return request(`/api/pos-order/orders?tableCode=${encodeURIComponent(tableCode)}`);
}

export function createOpenOrder(input: {
  tableCode: string;
  guestEthnicity: GuestEthnicity;
  guestKidsCount: number;
  staffId?: string;
}): Promise<{ order: OpenOrderRecord }> {
  return request('/api/pos-order/orders', { method: 'POST', body: JSON.stringify(input) });
}

export function confirmOrderItems(
  orderId: string,
  items: CartLine[],
): Promise<{ items: OrderItemRecord[] }> {
  return request(`/api/pos-order/orders/${orderId}/items`, {
    method: 'POST',
    body: JSON.stringify({
      items: items.map((l) => ({
        menuId: l.menuId,
        menuName: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        selectedOptions: l.selectedOptions,
        lineTotal: l.unitPrice * l.qty,
      })),
    }),
  });
}

export function completeOrderPayment(
  orderId: string,
  input: {
    subtotal: number;
    vat: number;
    service: number;
    couponDiscount: number;
    total: number;
    method: 'cash' | 'qr' | 'card';
    amount: number;
    cashReceivedUsd?: number;
    cashReceivedKhr?: number;
    changeUsd?: number;
    changeKhr?: number;
  },
): Promise<{ ok: true }> {
  return request(`/api/pos-order/orders/${orderId}/complete`, { method: 'POST', body: JSON.stringify(input) });
}
