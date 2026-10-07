/**
 * AI経営相談チャット (2026-10-07 追加) の同一オリジン API クライアント。
 * /api/advisor の GET (履歴取得) / POST (発言送信・AI返信取得) を呼び出す。
 */

import type { Lang } from '@/lib/i18n/lang';

export class PosAdvisorApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosAdvisorApiError';
  }
}

export type AdvisorMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  staffName: string | null;
  createdAt: string;
};

async function parseErrorOrThrow(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // ignore
  }
  throw new PosAdvisorApiError(message, res.status);
}

export async function fetchAdvisorHistory(): Promise<AdvisorMessage[]> {
  const res = await fetch('/api/advisor', { method: 'GET' });
  if (!res.ok) await parseErrorOrThrow(res);
  const json = (await res.json()) as { messages: AdvisorMessage[] };
  return json.messages;
}

export async function sendAdvisorMessage(message: string, lang?: Lang): Promise<{ userMessage: AdvisorMessage; assistantMessage: AdvisorMessage }> {
  const res = await fetch('/api/advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, lang }),
  });
  if (!res.ok) await parseErrorOrThrow(res);
  return res.json() as Promise<{ userMessage: AdvisorMessage; assistantMessage: AdvisorMessage }>;
}
