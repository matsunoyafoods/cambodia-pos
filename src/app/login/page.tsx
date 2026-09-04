'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { checkStaffSession } from '@/lib/api-client';
import { checkPosStaffSession, getStaffRoster, loginWithPin, type PosStaffRosterEntry } from '@/lib/staff-client';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from '@/components/pos/language-context';

const ADMIN_LOGIN_URL =
  process.env.NEXT_PUBLIC_MATSUNOYA_DINE_ADMIN_LOGIN_URL ?? 'https://app.matsunoyafoods.com/admin-login';

// ログイン後の遷移先。'/pos' 以外の場所 (例: ハンディ注文 /pos/handy) を開いていた端末が
// ログイン画面に飛ばされた場合、ログイン後にレジ画面ではなく元の画面に戻れるようにする
// (2026-08-31 追加。「ハンディ注文機能」でハンディ端末からの直接ログインに対応するため)。
// '/'始まりの相対パス以外 (外部URL等) は無視して常に '/pos' にフォールバックする。
function safeNextPath(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/pos';
}

export default function LoginPage() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <Suspense fallback={null}>
        <LoginPageInner />
      </Suspense>
    </LanguageProvider>
  );
}

function LoginPageInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [staffName, setStaffName] = useState<string | null>(null);

  // POS ネイティブ PIN ログイン用の state
  const [roster, setRoster] = useState<PosStaffRosterEntry[] | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      // 先に POS ネイティブ (PIN) セッションを確認 (同一オリジンで速い)
      const posStaff = await checkPosStaffSession();
      if (posStaff) {
        setChecked(true);
        setStaffName(posStaff.display_name);
        router.replace(nextPath);
        return;
      }
      const staff = await checkStaffSession();
      setChecked(true);
      if (staff) {
        setStaffName(staff.display_name);
        router.replace(nextPath);
      }
    } finally {
      setChecking(false);
    }
  }, [router, nextPath]);

  // 初回マウント時は POS ネイティブ (PIN) セッションのみ自動チェックする。
  // dine (Telegram) セッションまで自動チェックしてしまうと、PIN ログインに
  // 切り替えたくてこのページに来たユーザーが dine セッションですぐ /pos へ
  // 押し戻されてしまう (スタッフ管理・メニュー管理画面から誘導されるケース)。
  // dine 側のチェックは「ログイン状態を確認」ボタンを押した時のみ行う。
  useEffect(() => {
    checkPosStaffSession().then((posStaff) => {
      if (posStaff) router.replace(nextPath);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PIN ログイン用のスタッフ一覧を取得 (未登録なら PIN ログイン欄自体を出さない)
  useEffect(() => {
    getStaffRoster()
      .then(({ staff }) => setRoster(staff))
      .catch(() => setRoster([]));
  }, []);

  async function handlePinLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStaffId || pin.length < 4) return;
    setPinLoading(true);
    setPinError(null);
    try {
      await loginWithPin(selectedStaffId, pin);
      router.replace(nextPath);
    } catch {
      setPinError(t('login.errorInvalid'));
      setPin('');
    } finally {
      setPinLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="text-6xl">🥩</div>
      <h1 className="text-2xl font-bold tracking-tight">Cambodia POS</h1>

      {roster && roster.length > 0 && (
        <form
          onSubmit={handlePinLogin}
          className="w-full rounded-xl border-2 border-border bg-card p-5 text-left"
        >
          <p className="mb-3 font-bold">{t('login.pinLoginTitle')}</p>
          <select
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
            className="mb-3 h-11 w-full rounded-lg border border-border px-3 text-[14px]"
          >
            <option value="">{t('login.selectStaffPlaceholder')}</option>
            {roster.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
          <input
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            className="mb-3 h-11 w-full rounded-lg border border-border px-3 text-center text-[16px] tracking-[0.3em]"
          />
          {pinError && <p className="mb-2 text-xs text-destructive">{pinError}</p>}
          <button
            type="submit"
            disabled={pinLoading || !selectedStaffId || pin.length < 4}
            className="h-11 w-full rounded-full bg-primary font-bold text-primary-foreground shadow-md disabled:opacity-60"
          >
            {pinLoading ? t('login.loggingIn') : t('login.loginButton')}
          </button>
        </form>
      )}

      {roster && roster.length > 0 && (
        <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          {t('login.or')}
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      <div className="w-full rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-left">
        <p className="font-bold text-amber-900 mb-3">{t('login.staffLoginRequired')}</p>
        <ol className="space-y-2 text-sm text-amber-900">
          <li>{t('login.step1')}</li>
          <li>{t('login.step2')}</li>
          <li>{t('login.step3')}</li>
        </ol>
        <a
          href={ADMIN_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block w-full rounded-full bg-[#0088cc] hover:bg-[#0077b3] px-6 py-3 text-white text-center font-bold shadow-md"
        >
          {t('login.openDineLogin')}
        </a>
      </div>

      <button
        onClick={check}
        disabled={checking}
        className="w-full rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground shadow-md disabled:opacity-60"
      >
        {checking ? t('login.checking') : t('login.checkStatus')}
      </button>

      {checked && !staffName && (
        <p className="text-sm text-muted-foreground">
          {t('login.notConfirmed')}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {t('login.persistNote')}
      </p>
    </main>
  );
}
