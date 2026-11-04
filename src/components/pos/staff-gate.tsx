'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { checkStaffSession } from '@/lib/api-client';
import { checkPosStaffSession } from '@/lib/staff-client';
import { getPosOrderMode, getPosOrderSettings } from '@/lib/pos-order-client';
import type { FeatureKey } from '@/lib/pos-types';
import { StaffContext, type AuthenticatedStaff } from './staff-context';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// URL パス → 機能キーの対応 (2026-11-04 追加。設定画面「使用する機能」でOFFにした機能は、
// ハンバーガーメニューから隠すだけでなく直接URLを打って開かれても入れないようにする。
// POSネイティブ店舗のみ対象 (dine 連携店舗=現状の松之屋フーズは常に全機能有効のまま、
// 挙動を一切変えない。multi-tenant-productization-spec.md 参照)。
const PATH_FEATURE_MAP: Record<string, FeatureKey> = {
  '/pos/reservations': 'reservations',
  '/pos/handy': 'handy',
  '/pos/kitchen': 'kitchen',
  '/pos/drinks': 'drinks',
  '/pos/qr-codes': 'qrCodes',
  '/pos/expenses': 'expenses',
  '/pos/timecard': 'timecard',
  '/pos/insights': 'insights',
  '/pos/advisor': 'advisor',
  '/pos/sales-report': 'salesReport',
  '/pos/sales-entry': 'salesEntry',
  '/pos/register-closing': 'registerClosing',
  '/pos/payroll': 'payroll',
};

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
  const pathname = usePathname();
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

  // 機能ON/OFF設定によるルートガード (2026-11-04 追加)。POSネイティブ店舗のみ判定し、
  // dine 連携店舗 (現状の松之屋フーズ) では一切フェッチせず挙動を変えない。
  // 取得失敗時は fail-open (ブロックしない) — 設定取得エラーで業務が止まるのを避けるため。
  useEffect(() => {
    if (!staff || !pathname) return;
    const featureKey = PATH_FEATURE_MAP[pathname];
    if (!featureKey) return;
    let cancelled = false;
    (async () => {
      try {
        const { menuSource } = await getPosOrderMode();
        if (menuSource !== 'pos_native') return;
        const settings = await getPosOrderSettings();
        if (cancelled) return;
        if (settings.enabledFeatures[featureKey] === false) {
          router.replace('/pos');
        }
      } catch {
        // fail-open
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [staff, pathname, router]);

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
