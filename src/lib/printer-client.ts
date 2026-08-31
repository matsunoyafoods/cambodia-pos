/**
 * プリンター設定画面用の API クライアント (2026-08-31 プリンター実装で追加)。
 * settings-client.ts と同じ方針 (同一オリジン、Cookie セッション)。
 */

import type { PrinterConfig } from '@/lib/pos-types';

export class PosPrinterApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosPrinterApiError';
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
      // ignore
    }
    throw new PosPrinterApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export async function listPrinters(): Promise<PrinterConfig[]> {
  const { printers } = await request<{ printers: PrinterConfig[] }>('/api/settings/printers');
  return printers;
}

export type CreatePrinterInput = {
  name: string;
  role: PrinterConfig['role'];
  connectionType: PrinterConfig['connectionType'];
  paperWidthMm: number;
  deviceName?: string;
  lanIp?: string;
  lanPort?: number;
};

export async function createPrinter(input: CreatePrinterInput): Promise<PrinterConfig> {
  const { printer } = await request<{ printer: PrinterConfig }>('/api/settings/printers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return printer;
}

export async function updatePrinter(id: string, patch: Partial<CreatePrinterInput & { enabled: boolean }>): Promise<PrinterConfig> {
  const { printer } = await request<{ printer: PrinterConfig }>(`/api/settings/printers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return printer;
}

export async function deletePrinter(id: string): Promise<void> {
  await request(`/api/settings/printers/${id}`, { method: 'DELETE' });
}

export async function testPrint(id: string): Promise<void> {
  await request(`/api/settings/printers/${id}/test`, { method: 'POST' });
}

export async function getPrintAgentToken(): Promise<string | null> {
  const { token } = await request<{ token: string | null }>('/api/settings/print-agent-token');
  return token;
}

export async function regeneratePrintAgentToken(): Promise<string> {
  const { token } = await request<{ token: string }>('/api/settings/print-agent-token', { method: 'POST' });
  return token;
}
