/**
 * レジ画面向け、卓の「開いている伝票 (pos.orders)」用の公開 (認証なし) API クライアント。
 * /api/pos-order/orders/* は withPosStaff を使わない (理由は pos-order-client.ts と同じ)。
 */

import type { CartLine, GuestEthnicity } from '@/lib/pos-types';
import { cartLineDiscountLabel, cartLineNetTotal } from '@/lib/cart';

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

export function createOpenOrder(input: { tableCode: string; staffId?: string }): Promise<{ order: OpenOrderRecord }> {
  return request('/api/pos-order/orders', { method: 'POST', body: JSON.stringify(input) });
}

// 客層記録 (2026-08-31 変更: 卓を開く時ではなく「会計へ進む」時に呼ぶよう移動。
// 詳細は src/app/api/pos-order/orders/[id]/guest/route.ts のコメント参照)。
export function recordGuestDemographics(
  orderId: string,
  input: { guestEthnicity: GuestEthnicity; guestKidsCount: number; staffId?: string },
): Promise<{ order: OpenOrderRecord }> {
  return request(`/api/pos-order/orders/${orderId}/guest`, { method: 'POST', body: JSON.stringify(input) });
}

export function confirmOrderItems(
  orderId: string,
  items: CartLine[],
): Promise<{ items: OrderItemRecord[] }> {
  return request(`/api/pos-order/orders/${orderId}/items`, {
    method: 'POST',
    body: JSON.stringify({
      // 急遽の値引き (cartLineDiscount) が入っているラインは、値引き後の金額を lineTotal と
      // して送る (厨房伝票・会計・pos.orders の集計は全てこの line_total を積み上げて出すため、
      // ここで反映しておけば他の画面・APIは変更不要)。menuName にも値引きラベルを付けて、
      // 後から伝票を見た時にどのラインへ・どんな値引きが入ったか分かるようにする。
      items: items.map((l) => {
        const discountLabel = cartLineDiscountLabel(l);
        return {
          menuId: l.menuId,
          menuName: discountLabel ? `${l.name} [${discountLabel}]` : l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          selectedOptions: l.selectedOptions,
          lineTotal: cartLineNetTotal(l),
        };
      }),
    }),
  });
}

// 分割払い ($10 ABA + $10 現金) や割り勘 (人数で分けて個別に会計) に対応するため、payments を
// 配列で渡す (2026-08-31 変更。以前は method/amount 等が単一の支払いのみだった)。
export function completeOrderPayment(
  orderId: string,
  input: {
    subtotal: number;
    vat: number;
    service: number;
    couponDiscount: number;
    orderDiscount: number;
    total: number;
    payments: {
      // 決済方法の表示名 (自由文字列。2026-08-31 変更。receipt-format.ts 参照)
      method: string;
      amount: number;
      cashReceivedUsd?: number;
      cashReceivedKhr?: number;
      changeUsd?: number;
      changeKhr?: number;
    }[];
  },
): Promise<{ ok: true }> {
  return request(`/api/pos-order/orders/${orderId}/complete`, { method: 'POST', body: JSON.stringify(input) });
}

// 確定済み (厨房送信済み) の注文品目に、後から値引きを設定・変更・解除する。
// discount=null で値引き解除 (2026-08-31 追加)。
export function updateConfirmedItemDiscount(
  orderId: string,
  itemId: string,
  discount: { type: 'percent' | 'fixed'; value: number } | null,
): Promise<{ item: OrderItemRecord }> {
  return request(`/api/pos-order/orders/${orderId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      discountType: discount?.type ?? null,
      discountValue: discount?.value ?? null,
    }),
  });
}

// 確定済み (厨房送信済み) の注文品目の数量を変更する。既存の値引きはサーバー側で
// (menu_name のラベルから) 維持したまま再計算される (2026-08-31 追加)。
export function updateConfirmedItemQty(
  orderId: string,
  itemId: string,
  qty: number,
): Promise<{ item: OrderItemRecord }> {
  return request(`/api/pos-order/orders/${orderId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ qty }),
  });
}

// 確定済みの注文品目を丸ごと削除する (取り消し) (2026-08-31 追加。「カートに一度注文済みに
// なると削除や変更ができません。できるようにしてください」)。
export function deleteConfirmedItem(orderId: string, itemId: string): Promise<{ ok: true }> {
  return request(`/api/pos-order/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
}

// 席移動: 開いている伝票・滞在セッションを別のテーブルへ移す (2026-08-31 追加)。
export function moveTable(fromTableCode: string, toTableCode: string): Promise<{ ok: true }> {
  return request('/api/pos-order/table-move', { method: 'POST', body: JSON.stringify({ fromTableCode, toTableCode }) });
}

// 会計合算: 複数テーブルの開いている伝票を1つ (targetTableCode) に合算する (2026-08-31 追加)。
export function mergeTables(
  targetTableCode: string,
  sourceTableCodes: string[],
): Promise<{ ok: true; mergedCount: number; skipped: string[] }> {
  return request('/api/pos-order/table-merge', {
    method: 'POST',
    body: JSON.stringify({ targetTableCode, sourceTableCodes }),
  });
}

// テーブルリセット: 会計せずに、間違えて選択・注文した卓を空席に戻す (2026-08-31 追加。
// 「間違えて選択しても赤マークを消すことができるようにしてください」)。開いている伝票が
// あれば void 扱いにし、滞在セッションを削除する (呼び出し側は window.confirm 等で
// 取り消し不能であることを必ず確認してから呼ぶこと)。
export function resetTable(tableCode: string): Promise<{ ok: true; hadOpenOrder: boolean }> {
  return request('/api/pos-order/table-reset', { method: 'POST', body: JSON.stringify({ tableCode }) });
}

// 厨房伝票・レシート・領収書の印刷キューに積む (2026-08-31 プリンター実装で追加。同日、
// プリンターごとの用紙幅・店舗のヘッダー/フッター文言・ロゴをサーバー側で当てはめるように
// 変更したため、整形済みテキストではなく元データを渡す形に変更)。該当ロールのプリンターが
// 設定・有効化されていなくても静かに printersQueued:0 を返すだけなので、レジ操作の失敗として
// 扱わなくてよい (呼び出し側は catch で握りつぶして良い)。
type PrintJobResult = { ok: true; printersQueued: number };

export function enqueueKitchenPrintJob(input: {
  orderId?: string;
  tableCode: string | null;
  items: { name: string; qty: number; optionsLabel?: string }[];
}): Promise<PrintJobResult> {
  return request('/api/pos-order/print-jobs', { method: 'POST', body: JSON.stringify({ kind: 'kitchen', ...input }) });
}

export function enqueueReceiptPrintJob(input: {
  orderId?: string;
  tableCode: string | null;
  items: { name: string; qty: number; lineTotal: number }[];
  subtotal: number;
  vat: number;
  vatRate: number;
  vatInclusive: boolean;
  service: number;
  serviceRate: number;
  couponDiscount: number;
  orderDiscount: number;
  total: number;
  payments: { method: string; amount: number }[];
}): Promise<PrintJobResult> {
  return request('/api/pos-order/print-jobs', { method: 'POST', body: JSON.stringify({ kind: 'receipt', ...input }) });
}

// 領収書 (宛名・但し書き入りの正式な領収書) の発行 (2026-08-31 追加)。
export function enqueueInvoicePrintJob(input: {
  orderId?: string;
  recipientName: string;
  description: string;
  total: number;
  invoiceNo: string;
}): Promise<PrintJobResult> {
  return request('/api/pos-order/print-jobs', { method: 'POST', body: JSON.stringify({ kind: 'invoice', ...input }) });
}
