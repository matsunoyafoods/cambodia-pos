'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import { clockIn, clockOut, endBreak, getTimecardStatus, PosTimecardApiError, startBreak, type MyTimecardStatus } from '@/lib/timecard-client';
import { getStaffRoster, type PosStaffRosterEntry } from '@/lib/staff-client';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';
import { localeForLang, type Lang } from '@/lib/i18n/lang';

type TFunc = ReturnType<typeof useLanguage>['t'];

// 勤怠打刻画面 (2026-08-31 追加。「人件費に関しては出勤、休憩、退勤は記録できるように」)。
// シフト作成機能は無し。誰でも自分の打刻ができる (staff 権限含む)。
// 2026-09-01: レジ横の共有端末を想定し、打刻対象スタッフをプルダウンで選べるようにした
// (Tom「打刻についてプルダウンでスタッフを選べるようにしてください」)。ログインしたまま
// 端末を共有し、出勤する本人がプルダウンで自分の名前を選んで打刻する運用を想定している。
//
// 勤怠レポート (期間・時給から人件費を概算する manager 以上向けの集計表、CSV/PDF出力等) は
// 2026-09-04 に給料タブへ移設した (Tom「退勤レポートは給料のタブに入れてください」)。
// 実装は attendance-report-tab.tsx の AttendanceReportTab、payroll-screen.tsx の
// 「勤怠レポート」サブタブから呼ばれる。この画面には打刻 (PunchCard) だけが残っている。

function statusLabel(status: MyTimecardStatus['status'], t: TFunc): string {
  return t(`timecardScreen.status.${status}`);
}

function fmtTime(iso: string | null, lang: Lang = 'ja'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(localeForLang(lang), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function TimecardScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <TimecardScreenInner />
    </LanguageProvider>
  );
}

function TimecardScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3 print:hidden">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t('timecardScreen.title')}</div>
      </div>
      <div className="flex-1 overflow-auto p-5 print:overflow-visible print:p-0">
        <div className="mx-auto flex max-w-[720px] flex-col gap-6 print:max-w-none">
          {!isPosNative ? (
            <PosNativeOnlyNotice />
          ) : (
            <div className="print:hidden">
              <PunchCard />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 経費・勤怠は POS PIN ログイン (pos_staff_session Cookie) 専用の API しか無いため、
// matsunoya-dine ログイン (authMode 'dine') で /pos に入っているスタッフには、生の
// "unauthorized" エラーではなくこの案内を出す (2026-09-01 追加。dine ログインでは
// この画面のデータが扱えない、という Tom への説明に対応)。
// dine 対応は別途 matsunoya-dine 側に署名付きトークン発行 API を追加する必要があり、
// 今回は見送り (「I'm hungryアプリ」チャット側の対応事項として later)。
function PosNativeOnlyNotice() {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
      <p className="mb-2 font-bold">{t('common.posNativeOnlyTitle')}</p>
      <p className="mb-3 text-[13px] leading-relaxed">{t('common.posNativeOnlyBody')}</p>
      <a
        href="/login"
        className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md"
      >
        {t('common.posNativeOnlyLoginLink')}
      </a>
    </div>
  );
}

function PunchCard() {
  const { t, lang } = useLanguage();
  const me = useStaff();
  const [roster, setRoster] = useState<PosStaffRosterEntry[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState(me.id);
  const [status, setStatus] = useState<MyTimecardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getStaffRoster()
      .then(({ staff }) => setRoster(staff))
      .catch(() => {
        // ロースター取得失敗時は自分のみプルダウンに出す (フォールバック)。
        setRoster([{ id: me.id, display_name: me.display_name }]);
      });
  }, [me.id, me.display_name]);

  const load = useCallback(() => {
    getTimecardStatus(selectedStaffId)
      .then(setStatus)
      .catch((err) => setError(err instanceof PosTimecardApiError ? err.message : t('timecardScreen.statusLoadError')));
  }, [selectedStaffId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedName = roster.find((r) => r.id === selectedStaffId)?.display_name ?? me.display_name;

  async function run(actionLabelKey: string, action: (staffId: string) => Promise<void>) {
    if (!confirm(t('timecardScreen.punchConfirm', { name: selectedName, action: t(actionLabelKey) }))) return;
    setBusy(true);
    setError(null);
    try {
      await action(selectedStaffId);
      load();
    } catch (err) {
      setError(err instanceof PosTimecardApiError ? err.message : t('common.actionError'));
    } finally {
      setBusy(false);
    }
  }

  const s = status?.status ?? null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="text-[13.5px] font-semibold">{t('timecardScreen.staffToPunchLabel')}</div>
          <select
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
            className="h-9 rounded-lg border border-border px-2.5 text-[13px] font-semibold"
          >
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name}
              </option>
            ))}
          </select>
        </div>
        {s && (
          <span
            className={
              'rounded-full px-3 py-1 text-[12px] font-semibold ' +
              (s === 'working'
                ? 'bg-emerald-100 text-emerald-700'
                : s === 'on_break'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-secondary text-muted-foreground')
            }
          >
            {statusLabel(s, t)}
          </span>
        )}
      </div>

      {status?.timecard && (
        <div className="mb-3 text-[12.5px] text-muted-foreground">{t('timecardScreen.clockInLabel', { time: fmtTime(status.timecard.clockIn, lang) })}</div>
      )}

      {error && <div className="mb-2 text-[12.5px] text-destructive">{error}</div>}

      <div className="flex flex-wrap gap-2.5">
        <button
          disabled={busy || s !== 'not_clocked_in'}
          onClick={() => run('timecardScreen.action.clockIn', (id) => clockIn(id))}
          className="h-11 rounded-lg bg-primary px-5 text-[13.5px] font-bold text-primary-foreground disabled:opacity-40"
        >
          {t('timecardScreen.action.clockIn')}
        </button>
        <button
          disabled={busy || s !== 'working'}
          onClick={() => run('timecardScreen.action.breakStart', (id) => startBreak(id))}
          className="h-11 rounded-lg border border-border px-5 text-[13.5px] font-bold disabled:opacity-40"
        >
          {t('timecardScreen.action.breakStart')}
        </button>
        <button
          disabled={busy || s !== 'on_break'}
          onClick={() => run('timecardScreen.action.breakEnd', (id) => endBreak(id))}
          className="h-11 rounded-lg border border-border px-5 text-[13.5px] font-bold disabled:opacity-40"
        >
          {t('timecardScreen.action.breakEnd')}
        </button>
        <button
          disabled={busy || (s !== 'working' && s !== 'on_break')}
          onClick={() => run('timecardScreen.action.clockOut', (id) => clockOut(id))}
          className="h-11 rounded-lg border border-destructive px-5 text-[13.5px] font-bold text-destructive disabled:opacity-40"
        >
          {t('timecardScreen.action.clockOut')}
        </button>
      </div>

      <TodayHistory punches={status?.todayPunches ?? []} lang={lang} t={t} />
    </div>
  );
}

// 本日の打刻履歴 (2026-09-28 追加。Tom「出勤・退勤しても同じ画面に履歴が残るようにしてほしい」
// への対応)。選択中のスタッフ (selectedStaffId) の記録だけを表示する — API側 (status/route.ts)
// が対象スタッフで絞り込んだ todayPunches をそのまま渡しているだけなので、個人ごとに独立して
// 表示される。「設定した時間に消える」は API 側の historyWindowStartIso() (店舗設定
// timecardHistoryResetTime) によるフィルタで実現しており、この画面は渡された一覧をそのまま出すだけ。
function TodayHistory({ punches, lang, t }: { punches: MyTimecardStatus['todayPunches']; lang: Lang; t: TFunc }) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 text-[12.5px] font-semibold text-muted-foreground">{t('timecardScreen.historyTitle')}</div>
      {punches.length === 0 ? (
        <div className="text-[12.5px] text-muted-foreground">{t('timecardScreen.historyEmpty')}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {punches.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2 text-[12.5px]">
              <span>
                {fmtTime(p.clockIn, lang)} 〜 {p.clockOut ? fmtTime(p.clockOut, lang) : t('timecardScreen.status.working')}
              </span>
              {p.breaks.length > 0 && (
                <span className="text-muted-foreground">{t('timecardScreen.breakCountShort', { count: p.breaks.length })}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
