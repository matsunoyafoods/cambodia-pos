/**
 * キッチンモニター (2026-09-03 追加) 向け、公開 (認証なし) API クライアント。
 * /api/pos-order/kitchen-tickets/* は withPosStaff を使わない (理由は pos-order-orders-client.ts と同じ)。
 */

import type { CartLine, TranslationMap } from '@/lib/pos-types';

export class PosOrderKitchenApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosOrderKitchenApiError';
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
    throw new PosOrderKitchenApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type KitchenTicketItem = {
  id: string;
  order_id: string;
  table_code: string | null;
  menu_name: string;
  qty: number;
  /** 各選択肢に、現在の翻訳 (menu_option_choices.translations) をサーバー側で付与したもの
   * (2026-09-04 追加)。choiceLabel 自体は注文確定時点の日本語スナップショットのまま。 */
  selected_options: (CartLine['selectedOptions'][number] & { translations: TranslationMap | null })[];
  sent_to_kitchen_at: string;
  kitchen_done_at: string | null;
  kitchen_done_by_name: string | null;
  /** 完了済み数量 (2026-09-05 追加)。qty 未満ならまだ一部残っている状態。qty に達すると
   * kitchen_done_at がセットされ、その品目は全数完了扱いになる。 */
  kitchen_done_qty: number;
  /** フード/ドリンク区分 (2026-09-04 追加)。キッチンモニター/ドリンカーモニターの出し分けに使う。 */
  kind: 'food' | 'drink';
  /** 商品名の現在の翻訳 (menu_items.translations, 2026-09-04 追加)。menu_name はスナップショット
   * のままなので、表示側で menuText(menu_name, menu_translations) として使う。 */
  menu_translations: TranslationMap | null;
};

export function getKitchenTickets(): Promise<{ pending: KitchenTicketItem[]; recentlyDone: KitchenTicketItem[] }> {
  return request('/api/pos-order/kitchen-tickets');
}

export function markKitchenTicketDone(itemId: string, staffName?: string): Promise<{ item: KitchenTicketItem }> {
  return request(`/api/pos-order/kitchen-tickets/${itemId}`, { method: 'PATCH', body: JSON.stringify({ done: true, staffName }) });
}

/** 数量のうち1個だけ完了にする (2026-09-05 追加。キッチン/ドリンカーモニター専用)。
 * qty に達すると自動的に全数完了 (kitchen_done_at セット) になる。 */
export function completeOneKitchenTicketUnit(itemId: string, staffName?: string): Promise<{ item: KitchenTicketItem }> {
  return request(`/api/pos-order/kitchen-tickets/${itemId}`, { method: 'PATCH', body: JSON.stringify({ action: 'completeOne', staffName }) });
}

export function undoKitchenTicketDone(itemId: string): Promise<{ item: KitchenTicketItem }> {
  return request(`/api/pos-order/kitchen-tickets/${itemId}`, { method: 'PATCH', body: JSON.stringify({ done: false }) });
}
