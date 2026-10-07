/**
 * スタッフからのフィードバック報告 (誤字・不具合、2026-10-07 追加) の
 * 同一オリジン API クライアント。/api/feedback に送信するだけで、保存とTelegram通知は
 * サーバー側 (route.ts) が行う。
 */

export class PosFeedbackApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosFeedbackApiError';
  }
}

export async function submitFeedback(message: string, pagePath?: string): Promise<{ ok: true }> {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, pagePath }),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new PosFeedbackApiError(msg, res.status);
  }
  return res.json() as Promise<{ ok: true }>;
}
