'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

type ValidateState =
  | { status: 'loading' }
  | { status: 'invalid'; reason: string }
  | { status: 'ready'; storeName: string; contactName: string | null }
  | { status: 'done' };

export function OwnerSetupScreen({ token }: { token: string }) {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <OwnerSetupScreenInner token={token} />
    </LanguageProvider>
  );
}

function OwnerSetupScreenInner({ token }: { token: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [state, setState] = useState<ValidateState>({ status: 'loading' });
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/owner-setup/${token}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({ status: 'invalid', reason: body?.error ?? 'not_found' });
          return;
        }
        const body = await res.json();
        setState({ status: 'ready', storeName: body.storeName ?? '', contactName: body.contactName ?? null });
        if (body.contactName) setDisplayName(body.contactName);
      } catch {
        if (!cancelled) setState({ status: 'invalid', reason: 'not_found' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (pin !== pinConfirm) {
      setSubmitError(t('ownerSetup.pinMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/owner-setup/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, pin }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(
          body?.error === 'display_name_taken' ? t('ownerSetup.displayNameTaken') : t('ownerSetup.submitError'),
        );
        return;
      }
      setState({ status: 'done' });
    } catch {
      setSubmitError(t('ownerSetup.submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted-foreground">
        {t('ownerSetup.checking')}
      </main>
    );
  }

  if (state.status === 'invalid') {
    const reasonKey =
      state.reason === 'expired'
        ? 'ownerSetup.linkExpired'
        : state.reason === 'used'
          ? 'ownerSetup.linkUsed'
          : 'ownerSetup.linkInvalid';
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">⚠️</div>
        <p className="text-base font-bold">{t(reasonKey)}</p>
        <p className="text-sm text-muted-foreground">{t('ownerSetup.contactAdminHint')}</p>
      </main>
    );
  }

  if (state.status === 'done') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">✅</div>
        <p className="text-base font-bold">{t('ownerSetup.doneTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('ownerSetup.doneBody')}</p>
        <button
          onClick={() => router.push('/login')}
          className="mt-2 h-11 w-full rounded-full bg-primary px-6 font-bold text-primary-foreground shadow-md"
        >
          {t('ownerSetup.goToLogin')}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="text-5xl">🔑</div>
      <h1 className="text-xl font-bold tracking-tight">{t('ownerSetup.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('ownerSetup.welcomeStore', { storeName: state.storeName })}</p>
      <form onSubmit={handleSubmit} className="w-full rounded-xl border-2 border-border bg-card p-5 text-left">
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ownerSetup.displayNameLabel')}</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={50}
          className="mb-3 h-11 w-full rounded-lg border border-border px-3 text-[14px]"
        />
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ownerSetup.pinLabel')}</label>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          required
          className="mb-3 h-11 w-full rounded-lg border border-border px-3 text-center text-[16px] tracking-[0.3em]"
        />
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('ownerSetup.pinConfirmLabel')}</label>
        <input
          type="password"
          inputMode="numeric"
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
          required
          className="mb-3 h-11 w-full rounded-lg border border-border px-3 text-center text-[16px] tracking-[0.3em]"
        />
        {submitError && <p className="mb-2 text-xs text-destructive">{submitError}</p>}
        <button
          type="submit"
          disabled={submitting || displayName.trim().length === 0 || pin.length < 4}
          className="h-11 w-full rounded-full bg-primary font-bold text-primary-foreground shadow-md disabled:opacity-60"
        >
          {submitting ? t('ownerSetup.submitting') : t('ownerSetup.submitButton')}
        </button>
      </form>
    </main>
  );
}
