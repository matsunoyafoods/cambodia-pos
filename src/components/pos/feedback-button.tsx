'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { submitFeedback, PosFeedbackApiError } from '@/lib/feedback-client';
import { useLanguage } from './language-context';

// フィードバック送信ボタン (誤字・不具合報告、2026-10-07 追加)。Tom「スタッフが誤字を
// 見つけたらドックフーティングでAIに送信して修繕する」への対応。/pos/* の全画面に常駐する
// フローティングボタン (pos/layout.tsx の StaffGate 配下に設置、全スタッフが利用可能)。
// 送信すると pos.feedback_reports に保存され、Telegramへ通知される (アプリ内の一覧画面は
// 今回作らない。Tom確認済み)。
export function FeedbackButton() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function close() {
    setOpen(false);
    setMessage('');
    setError(null);
    setDone(false);
  }

  async function submit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback(message.trim(), pathname ?? undefined);
      setDone(true);
      setMessage('');
      setTimeout(close, 1400);
    } catch (err) {
      setError(err instanceof PosFeedbackApiError ? err.message : t('feedback.submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t('feedback.buttonLabel')}
        className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-[18px] shadow-lg print:hidden"
      >
        🐞
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center print:hidden" onClick={close}>
          <div
            className="flex w-full max-w-[420px] flex-col gap-3 rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-bold">{t('feedback.modalTitle')}</div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{t('feedback.modalBody')}</p>

            {done ? (
              <div className="rounded-lg bg-emerald-50 px-3 py-3 text-[13px] font-semibold text-emerald-700">{t('feedback.sentNote')}</div>
            ) : (
              <>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t('feedback.placeholder')}
                  rows={4}
                  maxLength={1000}
                  autoFocus
                  className="rounded-lg border border-border px-3 py-2.5 text-[13px]"
                />
                {error && <div className="text-[12px] text-destructive">{error}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={submit}
                    disabled={submitting || !message.trim()}
                    className="h-10 flex-1 rounded-lg bg-primary text-[13px] font-bold text-primary-foreground disabled:opacity-50"
                  >
                    {submitting ? t('feedback.sending') : t('feedback.sendButton')}
                  </button>
                  <button onClick={close} className="h-10 rounded-lg border border-border px-4 text-[13px] font-semibold">
                    {t('common.cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
