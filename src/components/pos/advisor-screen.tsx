'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import { fetchAdvisorHistory, sendAdvisorMessage, PosAdvisorApiError, type AdvisorMessage } from '@/lib/advisor-client';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// AI経営相談チャット (2026-10-07 追加。Tom「この診断をもとにそのままAIとやり取りができる。
// AIは経営コンサルタントとして相談にのってくれるtalk機能」への対応)。
// 「AI分析・課題提案」(/pos/insights) とは別の、期間を区切らない常設の相談チャット
// (Tom確認済み: 「期間を区切らない全体相談チャット」「保存する」)。owner/manager限定
// (insights-screen.tsx と同じ access-gating パターン)。

export function AdvisorScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <AdvisorScreenInner />
    </LanguageProvider>
  );
}

function AdvisorScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = me.role === 'owner' || me.role === 'manager';

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t('advisor.title')}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!isPosNative ? (
          <div className="overflow-auto p-5">
            <PosNativeOnlyNotice />
          </div>
        ) : !canManage ? (
          <div className="p-5">
            <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">{t('common.managerOnly')}</div>
          </div>
        ) : (
          <AdvisorChatPanel />
        )}
      </div>
    </div>
  );
}

function PosNativeOnlyNotice() {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
      <p className="mb-2 font-bold">{t('common.posNativeOnlyTitle')}</p>
      <p className="mb-3 text-[13px] leading-relaxed">{t('common.posNativeOnlyBody')}</p>
      <a href="/login" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md">
        {t('common.posNativeOnlyLoginLink')}
      </a>
    </div>
  );
}

function AdvisorChatPanel() {
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<AdvisorMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdvisorHistory()
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof PosAdvisorApiError ? err.message : t('advisor.loadError'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    setDraft('');
    try {
      const { userMessage, assistantMessage } = await sendAdvisorMessage(text, lang);
      setMessages((prev) => [...(prev ?? []), userMessage, assistantMessage]);
    } catch (err) {
      setSendError(err instanceof PosAdvisorApiError ? err.message : t('advisor.sendError'));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          <p className="rounded-lg border border-border bg-secondary/20 p-3 text-[11.5px] leading-relaxed text-muted-foreground">{t('advisor.disclaimer')}</p>

          {loadError && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-[13px] text-destructive">{loadError}</div>}

          {messages && messages.length === 0 && !loadError && <div className="py-8 text-center text-[13px] text-muted-foreground">{t('advisor.emptyState')}</div>}

          {messages?.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {sending && <div className="flex justify-start text-[12.5px] text-muted-foreground">{t('advisor.sending')}</div>}

          {sendError && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-[13px] text-destructive">{sendError}</div>}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border p-4">
        <div className="mx-auto flex max-w-[720px] items-end gap-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t('advisor.placeholder')}
            rows={2}
            maxLength={2000}
            className="flex-1 resize-none rounded-lg border border-border px-3 py-2.5 text-[13.5px]"
          />
          <button
            onClick={handleSend}
            disabled={sending || draft.trim().length === 0}
            className="h-10 flex-shrink-0 rounded-lg bg-primary px-5 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {t('advisor.sendButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
