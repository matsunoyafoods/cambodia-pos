'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { checkStaffSession } from '@/lib/api-client';
import { checkPosStaffSession, getStaffRoster, loginWithPin, type PosStaffRosterEntry } from '@/lib/staff-client';

const ADMIN_LOGIN_URL =
  process.env.NEXT_PUBLIC_MATSUNOYA_DINE_ADMIN_LOGIN_URL ?? 'https://app.matsunoyafoods.com/admin-login';

export default function LoginPage() {
  const router = useRouter();
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
        router.replace('/pos');
        return;
      }
      const staff = await checkStaffSession();
      setChecked(true);
      if (staff) {
        setStaffName(staff.display_name);
        router.replace('/pos');
      }
    } finally {
      setChecking(false);
    }
  }, [router]);

  // 初回マウント時にも一度チェック（すでにログイン済みならすぐ /pos へ）
  useEffect(() => {
    check();
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
      router.replace('/pos');
    } catch {
      setPinError('スタッフ名またはPINが正しくありません');
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
          <p className="mb-3 font-bold">PINでログイン</p>
          <select
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
            className="mb-3 h-11 w-full rounded-lg border border-border px-3 text-[14px]"
          >
            <option value="">スタッフを選択…</option>
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
            {pinLoading ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      )}

      {roster && roster.length > 0 && (
        <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          または
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      <div className="w-full rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-left">
        <p className="font-bold text-amber-900 mb-3">スタッフログインが必要です</p>
        <ol className="space-y-2 text-sm text-amber-900">
          <li>1. 下のボタンで matsunoya-dine の管理画面ログインを開く</li>
          <li>2. Telegram Bot 経由でログインを完了する</li>
          <li>3. このタブに戻って「ログイン状態を確認」を押す</li>
        </ol>
        <a
          href={ADMIN_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block w-full rounded-full bg-[#0088cc] hover:bg-[#0077b3] px-6 py-3 text-white text-center font-bold shadow-md"
        >
          matsunoya-dine でログインする
        </a>
      </div>

      <button
        onClick={check}
        disabled={checking}
        className="w-full rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground shadow-md disabled:opacity-60"
      >
        {checking ? '確認中…' : 'ログイン状態を確認'}
      </button>

      {checked && !staffName && (
        <p className="text-sm text-muted-foreground">
          まだログインが確認できません。同じブラウザで matsunoya-dine のログインを完了してから、もう一度お試しください。
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        ※ 一度ログインすれば、同じブラウザでは約30日間ログイン状態が保持されます。
      </p>
    </main>
  );
}
