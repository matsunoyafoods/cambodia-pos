/**
 * プリンター設定画面用の API クライアント (2026-08-31 プリンター実装で追加)。
 * settings-client.ts と同じ方針 (同一オリジン、Cookie セッション)。
 */

import type { PaymentMethodConfig, PrinterConfig } from '@/lib/pos-types';

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

// レシート・領収書の印字設定 (ヘッダー/フッター文言・ロゴ) (2026-08-31 追加)。

export type ReceiptFormatInfo = { headerText: string; footerText: string; hasLogo: boolean };

export async function getReceiptFormat(): Promise<ReceiptFormatInfo> {
  return request<ReceiptFormatInfo>('/api/settings/receipt-format');
}

export async function updateReceiptFormat(input: { headerText: string; footerText: string }): Promise<void> {
  await request('/api/settings/receipt-format', { method: 'POST', body: JSON.stringify(input) });
}

export async function getReceiptLogo(): Promise<string | null> {
  const { logoPngBase64 } = await request<{ logoPngBase64: string | null }>('/api/settings/receipt-logo');
  return logoPngBase64;
}

export async function uploadReceiptLogo(pngBase64: string): Promise<void> {
  await request('/api/settings/receipt-logo', { method: 'POST', body: JSON.stringify({ pngBase64 }) });
}

export async function deleteReceiptLogo(): Promise<void> {
  await request('/api/settings/receipt-logo', { method: 'DELETE' });
}

// 決済方法の管理 (設定画面「決済設定」タブ用) (2026-08-31 追加)。

export async function listPaymentMethods(): Promise<PaymentMethodConfig[]> {
  const { paymentMethods } = await request<{ paymentMethods: PaymentMethodConfig[] }>('/api/settings/payment-methods');
  return paymentMethods;
}

export async function createPaymentMethod(input: { name: string; isCash: boolean }): Promise<PaymentMethodConfig> {
  const { paymentMethod } = await request<{ paymentMethod: PaymentMethodConfig }>('/api/settings/payment-methods', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return paymentMethod;
}

export async function updatePaymentMethod(
  id: string,
  patch: Partial<{ name: string; isCash: boolean; enabled: boolean; sortOrder: number }>,
): Promise<PaymentMethodConfig> {
  const { paymentMethod } = await request<{ paymentMethod: PaymentMethodConfig }>(`/api/settings/payment-methods/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return paymentMethod;
}

export async function deletePaymentMethod(id: string): Promise<void> {
  await request(`/api/settings/payment-methods/${id}`, { method: 'DELETE' });
}
