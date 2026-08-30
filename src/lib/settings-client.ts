/**
 * POS ネイティブ運用店舗の一般設定・決済設定・連携モード管理 (設定画面用)。
 * 同一オリジン API クライアント。table-layout-client.ts 等と同じ方針。
 */

import type { PosSettings } from '@/lib/pos-types';

export class PosSettingsApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosSettingsApiError';
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
    throw new PosSettingsApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export function getGeneralSettings(): Promise<PosSettings> {
  return request('/api/settings/general');
}

export function updateGeneralSettings(patch: Partial<Omit<PosSettings, 'storeId'>>): Promise<PosSettings> {
  return request('/api/settings/general', { method: 'PATCH', body: JSON.stringify(patch) });
}

export type IntegrationMode = 'pos_native' | 'dine_live';

export function getIntegrationSettings(): Promise<{ menuSource: IntegrationMode }> {
  return request('/api/settings/integration');
}

export function updateIntegrationSettings(menuSource: IntegrationMode): Promise<{ menuSource: IntegrationMode }> {
  return request('/api/settings/integration', { method: 'PATCH', body: JSON.stringify({ menuSource }) });
}
