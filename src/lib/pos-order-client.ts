/**
 * レジ画面 (pos-app.tsx) 初期データ取得用、公開 (認証なし) API クライアント。
 * /api/pos-order/* は withPosStaff を使わない (dine 連携ログインの Cookie は
 * 別オリジンのためこのサーバーから見えず、レジ画面自体が読めなくなってしまうため)。
 * 詳細は src/app/api/pos-order/mode/route.ts のコメント参照。
 */

import type { MenuItem, PosSettings } from '@/lib/pos-types';
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

export function getPosOrderMenu(): Promise<{ items: MenuItem[] }> {
  return request('/api/pos-order/menu');
}

export function getPosOrderSettings(): Promise<PosSettings> {
  return request('/api/pos-order/settings');
}

export function getPosOrderTableLayout(): Promise<{ items: TableLayoutItemRecord[] }> {
  return request('/api/pos-order/table-layout');
}
