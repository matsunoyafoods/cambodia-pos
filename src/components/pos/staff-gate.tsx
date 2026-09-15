'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { checkStaffSession } from '@/lib/api-client';
import { checkPosStaffSession } from '@/lib/staff-client';
import { StaffContext, type AuthenticatedStaff } from './staff-context';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

/**
 * /pos/* 配下を保護する認証ガード。
 *
 * 2つの認証経路をこの順で試す:
 *   1. POS ネイティブ PIN ログイン (同一オリジン、高速)
 *   2. matsunoya-dine 連携ログイン (Telegram bot-login の Cookie 流用、別オリジン)
 * どちらも無ければ /login へ (multi-tenant-productization-spec.md §3.3)。
 */
export function StaffGate({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <StaffGateInner>{children}</StaffGateInner>
    </LanguageProvider>
  );
}

function StaffGateInner({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [staff, setStaff] = useState<AuthenticatedStaff | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const posNative = await checkPosStaffSession().catch(() => null);
      if (cancelled) return;
      if (posNative) {
        setStaff({ ...posNative, authMode: 'pos_native' });
        return;
      }

      const dine = await checkStaffSession().catch(() => null);
      if (cancelled) return;
      if (dine) {
        setStaff({ ...dine, authMode: 'dine' });
        return;
      }

      router.replace('/login');
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // PINセッションのスライディング延長 (2026-09-15 追加)。Cookie自体は
  // /api/staff/session 側で「チェックが通るたびに有効期限を延長」するようにしたが、
  // このガードは元々マウント時に1回しかチェックしないため、タブを開けっぱなしの
  // 営業中は何もCookieを更新しに行かない。実際に使われている (=このタブが開いている)
  // 限り定期的にpingして延長され続けるようにする (30分毎。TTL 12時間に対して十分短い)。
  useEffect(() => {
    if (!staff || staff.authMode !== 'pos_native') return;
    const interval = setInterval(
      () => {
        checkPosStaffSession().catch(() => {
          /* 失敗しても次回のポーリングに任せる。本当に期限切れなら次回ページ遷移時に
             staff-gate の resolve() が dine へフォールバック or ログイン画面へ誘導する */
        });
      },
      30 * 60 * 1000,
    );
    return () => clearInterval(interval);
  }, [staff]);

  if (staff === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        {t('loading.staffGate')}
      </div>
    );
  }
  if (staff === null) {
    return null; // リダイレクト中
  }

  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}
