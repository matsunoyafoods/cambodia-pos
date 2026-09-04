/**
 * レジ画面 (pos-app.tsx) 初期データ取得用、公開 (認証なし) API クライアント。
 * /api/pos-order/* は withPosStaff を使わない (dine 連携ログインの Cookie は
 * 別オリジンのためこのサーバーから見えず、レジ画面自体が読めなくなってしまうため)。
 * 詳細は src/app/api/pos-order/mode/route.ts のコメント参照。
 */

import type { HandyTableGroup, MenuItem, PaymentMethodConfig, PosSettings } from '@/lib/pos-types';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';

export class PosOrderApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosOrderApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    // レジが起動時に読む設定・メニュー・卓レイアウト等は「今の店舗の状態」がそのまま
    // 表示に直結するライブデータなので、ブラウザ/中間キャッシュに古い応答を握らせない
    // (2026-09-04 「色が変わらない」調査時に追加。真因は theme-color-injector.tsx 側の
    // 再取得タイミングだったが、念のためこちらも防御的に固定しておく)。
    cache: 'no-store',
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
    throw new PosOrderApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type PosOrderMenuSource = 'pos_native' | 'dine_live' | 'dine_synced';

export function getPosOrderMode(): Promise<{ menuSource: PosOrderMenuSource }> {
  return request('/api/pos-order/mode');
}

// categories: 大カテゴリー名を settings 側の並び順 (sort_order) 通りに並べたもの。
// レジ画面のタブ順はこの並びに従う (Tomさんの要望: 設定画面から大カテゴリーの並び順を
// 自由に変更できるようにする 2026-08-31)。
export function getPosOrderMenu(): Promise<{ items: MenuItem[]; categories: string[] }> {
  return request('/api/pos-order/menu');
}

export function getPosOrderSettings(): Promise<PosSettings> {
  return request('/api/pos-order/settings');
}

export function getPosOrderTableLayout(): Promise<{ items: TableLayoutItemRecord[] }> {
  return request('/api/pos-order/table-layout');
}

// 会計画面向け、有効な決済方法一覧 (2026-08-31 追加。決済方法を店舗側で自由に追加できる
// ようにしたため、以前のように 現金/QR/カード を画面に決め打ちせず、ここから取得して使う)。
export function getPosOrderPaymentMethods(): Promise<{ paymentMethods: PaymentMethodConfig[] }> {
  return request('/api/pos-order/payment-methods');
}

// ハンディ注文画面向け、卓グループ設定 (2026-08-31 追加。並び順・グループ分けは設定画面
// 「ハンディ表示」タブで owner/manager が設定する)。
export function getPosOrderHandyTableGroups(): Promise<{ groups: HandyTableGroup[] }> {
  return request('/api/pos-order/handy-table-groups');
}
