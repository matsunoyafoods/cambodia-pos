'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  clockIn,
  clockOut,
  deleteTimecard,
  endBreak,
  getTimecardRoundingSettings,
  getTimecardStatus,
  listTimecards,
  PosTimecardApiError,
  startBreak,
  updateTimecard,
  updateTimecardRoundingSettings,
  type MyTimecardStatus,
} from '@/lib/timecard-client';
import { getStaffRoster, listStaff, type PosStaffMember, type PosStaffRosterEntry } from '@/lib/staff-client';
import { applyTimecardRounding } from '@/lib/timecard-rounding';
import { downloadCsv } from '@/lib/csv-export';
import { DEFAULT_TIMECARD_ROUNDING, type TimecardRecord, type TimecardRoundingSettings } from '@/lib/pos-types';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

type TFunc = ReturnType<typeof useLanguage>['t'];

// スタッフ別タイムカード画像出力 (2026-09-01 追加。「明細をスタッフのテレグラムに送れるように」)。
// サーバー側でPDF/画像を生成する仕組みは追加せず、ブラウザ上のDOMを直接PNG画像化するライブラリ
// (html2canvas、クライアント専用・ビルド構成への影響なし) を使う。動的importでこのファイルが
// SSR/ビルド時に評価されないようにする。
async function loadHtml2Canvas() {
  const mod = await import('html2canvas');
  return mod.default;
}

// 勤怠打刻画面 (2026-08-31 追加。「人件費に関しては出勤、休憩、退勤は記録できるように」)。
// シフト作成機能は無し。誰でも自分の打刻ができ (staff 権限含む)、manager 以上には
// 全スタッフの勤怠レポート (期間・時給から人件費を概算) と手動修正・削除の機能を追加で出す。
// 2026-09-01: レジ横の共有端末を想定し、打刻対象スタッフをプルダウンで選べるようにした
// (Tom「打刻についてプルダウンでスタッフを選べるようにしてください」)。ログインしたまま
// 端末を共有し、出勤する本人がプルダウンで自分の名前を選んで打刻する運用を想定している。

function statusLabel(status: MyTimecardStatus['status'], t: TFunc): string {
  return t(`timecardScreen.status.${status}`);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 休憩時間を除いた実働分数。退勤前 (clockOut=null) は「今」を終了時刻とみなして計算する。
function workedMinutes(tc: { clockIn: string; clockOut: string | null; breaks: { startedAt: string; endedAt: string | null }[] }): number {
  const start = new Date(tc.clockIn).getTime();
  const end = tc.clockOut ? new Date(tc.clockOut).getTime() : Date.now();
  let breakMs = 0;
  for (const b of tc.breaks) {
    const bStart = new Date(b.startedAt).getTime();
    const bEnd = b.endedAt ? new Date(b.endedAt).getTime() : Date.now();
    breakMs += Math.max(0, bEnd - bStart);
  }
  return Math.max(0, Math.round((end - start - breakMs) / 60000));
}

function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

// PDF出力 (2026-09-01 追加。Tom「経費もタイムカードもPDF出力できるようにして欲しい」)。
// 専用のPDFライブラリは使わず、ブラウザの印刷機能 (印刷ダイアログの「PDFとして保存」) を
// 使う方式にした。QRコード印刷画面 (qr-codes-screen.tsx) と同じ考え方: サーバー側でPDFを
// 生成する仕組みを新設せずに済み、Vercelのビルド構成に影響しない。印刷時は操作用のボタン・
// フィルターや自分の打刻カードは非表示にし (print:hidden)、レポート表だけを印刷する。
function printReport(title: string) {
  const prevTitle = document.title;
  document.title = title;
  window.print();
  document.title = prevTitle;
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
  const canManage = me.role === 'owner' || me.role === 'manager';

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
            <>
              <div className="print:hidden">
                <PunchCard />
              </div>
              {canManage && <TimecardReport />}
            </>
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
  const { t } = useLanguage();
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
        <div className="mb-3 text-[12.5px] text-muted-foreground">{t('timecardScreen.clockInLabel', { time: fmtTime(status.timecard.clockIn) })}</div>
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
    </div>
  );
}

function TimecardReport() {
  const { t } = useLanguage();
  const me = useStaff();
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + '01'); // 今月1日
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<TimecardRecord[] | null>(null);
  const [staffList, setStaffList] = useState<PosStaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rounding, setRounding] = useState<TimecardRoundingSettings>(DEFAULT_TIMECARD_ROUNDING);

  const load = useCallback(() => {
    setError(null);
    Promise.all([listTimecards({ from, to }), listStaff()])
      .then(([timecards, { staff }]) => {
        setRows(timecards);
        setStaffList(staff);
      })
      .catch((err) => setError(err instanceof PosTimecardApiError ? err.message : t('timecardScreen.reportLoadError')));
  }, [from, to, t]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getTimecardRoundingSettings()
      .then(setRounding)
      .catch(() => {
        /* 取得失敗時はデフォルト (丸めなし) のまま。丸め設定パネル側で再取得できる */
      });
  }, []);

  const wageById = useMemo(() => new Map(staffList.map((s) => [s.id, s.hourly_wage_usd ?? null])), [staffList]);

  // 実働分数 (丸め設定適用後)。打刻の生記録自体は変更しない — 集計・表示にのみ使う。
  const roundedMinutes = useCallback((r: TimecardRecord) => applyTimecardRounding(workedMinutes(r), rounding), [rounding]);

  const totals = useMemo(() => {
    if (!rows) return { minutes: 0, cost: 0 };
    let minutes = 0;
    let cost = 0;
    for (const r of rows) {
      const m = roundedMinutes(r);
      minutes += m;
      const wage = wageById.get(r.staffId);
      if (wage) cost += (m / 60) * wage;
    }
    return { minutes, cost };
  }, [rows, wageById, roundedMinutes]);

  // 日別の概算人件費 (可視化グラフ用)。
  const dailyCost = useMemo(() => {
    if (!rows) return [] as { date: string; cost: number }[];
    const map = new Map<string, number>();
    for (const r of rows) {
      const date = r.clockIn.slice(0, 10);
      const wage = wageById.get(r.staffId);
      const cost = wage ? (roundedMinutes(r) / 60) * wage : 0;
      map.set(date, (map.get(date) ?? 0) + cost);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost }));
  }, [rows, wageById, roundedMinutes]);

  // スタッフ別グループ (スタッフ別画像出力用)。
  const byStaff = useMemo(() => {
    if (!rows) return [] as { staffId: string; staffName: string; records: TimecardRecord[] }[];
    const map = new Map<string, { staffId: string; staffName: string; records: TimecardRecord[] }>();
    for (const r of rows) {
      if (!map.has(r.staffId)) map.set(r.staffId, { staffId: r.staffId, staffName: r.staffName, records: [] });
      map.get(r.staffId)!.records.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.staffName.localeCompare(b.staffName, 'ja'));
  }, [rows]);

  async function handleDelete(id: string) {
    if (!confirm(t('timecardScreen.deleteConfirm'))) return;
    try {
      await deleteTimecard(id);
      load();
    } catch (err) {
      setError(err instanceof PosTimecardApiError ? err.message : t('common.deleteError'));
    }
  }

  function handleCsvExport() {
    if (!rows || rows.length === 0) return;
    downloadCsv(
      `${t('timecardScreen.csvFilename')}_${from}_${to}`,
      [
        t('timecardScreen.csvStaff'),
        t('timecardScreen.action.clockIn'),
        t('timecardScreen.action.clockOut'),
        t('timecardScreen.csvBreakCount'),
        `${t('timecardScreen.csvWorkedHours')}${rounding.enabled ? t('timecardScreen.csvRoundedSuffix') : ''}`,
        t('timecardScreen.csvEstimatedLaborCost'),
        t('timecardScreen.csvEdited'),
      ],
      rows.map((r) => {
        const wage = wageById.get(r.staffId);
        const m = roundedMinutes(r);
        return [
          r.staffName,
          fmtTime(r.clockIn),
          r.clockOut ? fmtTime(r.clockOut) : '',
          r.breaks.length,
          (m / 60).toFixed(2),
          wage ? ((m / 60) * wage).toFixed(2) : '',
          r.editedAt ? t('timecardScreen.editedBadge') : '',
        ];
      }),
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-0 print:p-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 print:hidden">
        <div className="text-[13.5px] font-semibold">{t('timecardScreen.reportTitle')}</div>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <span className="text-[12px] text-muted-foreground">〜</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <button onClick={load} className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold">
            {t('common.refresh')}
          </button>
          <button
            onClick={handleCsvExport}
            disabled={!rows || rows.length === 0}
            className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
          >
            {t('common.csvExportButton')}
          </button>
          <button
            onClick={() => printReport(`${t('timecardScreen.csvFilename')}_${from}_${to}`)}
            disabled={!rows || rows.length === 0}
            className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t('common.pdfExportButton')}
          </button>
        </div>
      </div>

      {/* 印刷時のみ表示するヘッダー (店名・期間・出力日時) */}
      <div className="hidden print:mb-4 print:block">
        <div className="text-[16px] font-bold">{t('timecardScreen.reportTitle')}{me.store_name ? ` — ${me.store_name}` : ''}</div>
        <div className="text-[12px] text-muted-foreground">
          {t('common.printHeaderPeriod', { from, to })} ・ {t('common.printHeaderGenerated', { datetime: new Date().toLocaleString('ja-JP') })}
          {rounding.enabled && ` ・ ${t('timecardScreen.roundingSummary', { minutes: rounding.unitMinutes, direction: roundingDirectionLabel(rounding.direction, t) })}`}
        </div>
      </div>

      <RoundingSettingsPanel rounding={rounding} onSaved={setRounding} />

      {error && <div className="mb-2 text-[12.5px] text-destructive print:hidden">{error}</div>}

      {rows && (
        <div className="mb-3 flex gap-5 rounded-lg bg-secondary/40 px-4 py-2.5 text-[12.5px] print:rounded-none print:bg-transparent print:px-0">
          <div>
            {t('timecardScreen.totalWorkedLabel')} <span className="font-semibold">{t('timecardScreen.hoursValue', { hours: fmtHours(totals.minutes) })}</span>
            {rounding.enabled && <span className="ml-1 text-[11px] text-muted-foreground">{t('timecardScreen.roundedSuffix')}</span>}
          </div>
          <div>
            {t('timecardScreen.estimatedLaborCostLabel')} <span className="font-semibold">${totals.cost.toFixed(2)}</span>
            <span className="ml-1 text-[11px] text-muted-foreground">{t('timecardScreen.noWageExcludedNote')}</span>
          </div>
        </div>
      )}

      <LaborCostChart data={dailyCost} />

      <StaffImageExportSection groups={byStaff} wageById={wageById} rounding={rounding} storeName={me.store_name} from={from} to={to} />

      {!rows && <div className="text-[12.5px] text-muted-foreground">{t('common.loadingEllipsis')}</div>}
      {rows?.length === 0 && <div className="text-[12.5px] text-muted-foreground">{t('timecardScreen.noRecordsForPeriod')}</div>}

      <div className="flex flex-col gap-2 print:gap-1.5">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-lg border border-border px-3.5 py-2.5 print:rounded-none print:border-0 print:border-b print:px-0 print:py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px]">
                <span className="font-semibold">{r.staffName}</span>
                <span className="ml-2 text-muted-foreground">
                  {fmtTime(r.clockIn)} 〜 {fmtTime(r.clockOut)}
                </span>
                {!r.clockOut && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 print:hidden">{t('timecardScreen.status.working')}</span>}
              </div>
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span>{t('timecardScreen.workedHoursShort', { hours: fmtHours(roundedMinutes(r)) })}</span>
                {r.breaks.length > 0 && <span>{t('timecardScreen.breakCountShort', { count: r.breaks.length })}</span>}
                {r.editedAt && <span className="text-amber-600">{t('timecardScreen.editedBadge')}</span>}
                <button onClick={() => setEditingId((v) => (v === r.id ? null : r.id))} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold print:hidden">
                  {t('common.edit')}
                </button>
                <button onClick={() => handleDelete(r.id)} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-destructive print:hidden">
                  {t('common.delete')}
                </button>
              </div>
            </div>
            {editingId === r.id && (
              <TimecardEditForm
                record={r}
                onDone={() => {
                  setEditingId(null);
                  load();
                }}
                onCancel={() => setEditingId(null)}
              />
            )}
            {r.note && <div className="mt-1.5 text-[11.5px] text-muted-foreground">{t('expenses.noteLine', { note: r.note })}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function roundingDirectionLabel(direction: TimecardRoundingSettings['direction'], t: TFunc): string {
  return t(`timecardScreen.roundingDirection.${direction}`);
}

function RoundingSettingsPanel({ rounding, onSaved }: { rounding: TimecardRoundingSettings; onSaved: (s: TimecardRoundingSettings) => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(rounding);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setDraft(rounding);
  }, [rounding, open]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateTimecardRoundingSettings(draft);
      onSaved(saved);
      setOpen(false);
    } catch (err) {
      setError(err instanceof PosTimecardApiError ? err.message : t('timecardScreen.roundingSaveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-border bg-secondary/20 print:hidden">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[12.5px] font-semibold">
        <span>
          {t('timecardScreen.roundingToggleLabel')}
          {rounding.enabled
            ? ` (${t('timecardScreen.roundingUnitSuffix', { unit: rounding.unitMinutes })}・${roundingDirectionLabel(rounding.direction, t)})`
            : ` (${t('timecardScreen.roundingDisabled')})`}
        </span>
        <span className="text-muted-foreground">{open ? t('common.close') : t('common.settingsButton')}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
          <p className="text-[11.5px] text-muted-foreground">{t('timecardScreen.roundingExplanation')}</p>
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
            {t('timecardScreen.roundingEnableCheckbox')}
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
              {t('timecardScreen.roundingUnitLabel')}
              <select
                value={draft.unitMinutes}
                disabled={!draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, unitMinutes: Number(e.target.value) as TimecardRoundingSettings['unitMinutes'] }))}
                className="h-9 rounded-lg border border-border px-2 text-[12.5px] disabled:opacity-50"
              >
                <option value={5}>{t('timecardScreen.roundingUnitSuffix', { unit: 5 })}</option>
                <option value={10}>{t('timecardScreen.roundingUnitSuffix', { unit: 10 })}</option>
                <option value={15}>{t('timecardScreen.roundingUnitSuffix', { unit: 15 })}</option>
                <option value={30}>{t('timecardScreen.roundingUnitSuffix', { unit: 30 })}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
              {t('timecardScreen.roundingDirectionLabelText')}
              <select
                value={draft.direction}
                disabled={!draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, direction: e.target.value as TimecardRoundingSettings['direction'] }))}
                className="h-9 rounded-lg border border-border px-2 text-[12.5px] disabled:opacity-50"
              >
                <option value="nearest">{t('timecardScreen.roundingDirection.nearest')}</option>
                <option value="up">{t('timecardScreen.roundingDirection.up')}</option>
                <option value="down">{t('timecardScreen.roundingDirection.down')}</option>
              </select>
            </label>
          </div>
          {error && <div className="text-[11.5px] text-destructive">{error}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="h-9 w-fit rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60">
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button onClick={() => setOpen(false)} className="h-9 w-fit rounded-lg border border-border px-4 text-[12.5px] font-semibold">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 日別の概算人件費の簡易棒グラフ (2026-09-01 追加。新規ライブラリは使わずSVGを手描き)。
function LaborCostChart({ data }: { data: { date: string; cost: number }[] }) {
  const { t } = useLanguage();
  if (data.length === 0 || data.every((d) => d.cost === 0)) return null;
  const max = Math.max(...data.map((d) => d.cost));
  const width = 640;
  const height = 140;
  const barGap = 4;
  const barWidth = Math.max(4, width / data.length - barGap);

  return (
    <div className="mb-3 rounded-lg border border-border p-3.5 print:hidden">
      <div className="mb-2 text-[12px] font-semibold text-muted-foreground">{t('timecardScreen.laborCostChartTitle')}</div>
      <svg viewBox={`0 0 ${width} ${height + 20}`} className="h-[120px] w-full" role="img" aria-label={t('timecardScreen.laborCostChartAriaLabel')}>
        {data.map((d, i) => {
          const barHeight = max > 0 ? (d.cost / max) * height : 0;
          const x = i * (barWidth + barGap);
          return (
            <g key={d.date}>
              <rect x={x} y={height - barHeight} width={barWidth} height={barHeight} fill="var(--primary, #2563eb)" rx={2}>
                <title>
                  {d.date}: ${d.cost.toFixed(2)}
                </title>
              </rect>
              {(data.length <= 15 || i % Math.ceil(data.length / 15) === 0) && (
                <text x={x + barWidth / 2} y={height + 14} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// スタッフ別タイムカード画像出力 (2026-09-01 追加。Tom「明細をスタッフのテレグラムに送れるように」)。
// スタッフごとの明細を1枚のPNG画像として書き出す。html2canvasでDOMをそのまま画像化するため、
// 画面には出さないオフスクリーンのカードを用意しておき、ボタン押下時にそのDOM要素を撮影する。
function StaffImageExportSection({
  groups,
  wageById,
  rounding,
  storeName,
  from,
  to,
}: {
  groups: { staffId: string; staffName: string; records: TimecardRecord[] }[];
  wageById: Map<string, number | null>;
  rounding: TimecardRoundingSettings;
  storeName?: string;
  from: string;
  to: string;
}) {
  const { t } = useLanguage();
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveImage(staffId: string, staffName: string) {
    const node = cardRefs.current[staffId];
    if (!node) return;
    setSavingId(staffId);
    setError(null);
    try {
      const html2canvas = await loadHtml2Canvas();
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(t('timecardScreen.imageGenerationError'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t('timecardScreen.imageFilenamePrefix')}_${staffName}_${from}_${to}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('timecardScreen.imageGenerationErrorRetry'));
    } finally {
      setSavingId(null);
    }
  }

  if (groups.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-border p-3.5 print:hidden">
      <div className="mb-1 text-[12px] font-semibold text-muted-foreground">{t('timecardScreen.staffImageExportTitle')}</div>
      {error && <div className="mb-1.5 text-[11.5px] text-destructive">{error}</div>}
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.staffId}
            onClick={() => saveImage(g.staffId, g.staffName)}
            disabled={savingId !== null}
            className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
          >
            {savingId === g.staffId ? t('timecardScreen.imageCreating') : t('timecardScreen.imageSaveButton', { name: g.staffName })}
          </button>
        ))}
      </div>

      {/* オフスクリーンの撮影用カード (画面には表示しない。display:none だと html2canvas が撮影できないため left: -9999px で退避する) */}
      <div style={{ position: 'absolute', left: -9999, top: 0 }} aria-hidden="true">
        {groups.map((g) => {
          const wage = wageById.get(g.staffId);
          let totalMinutes = 0;
          for (const r of g.records) totalMinutes += applyTimecardRounding(workedMinutes(r), rounding);
          const cost = wage ? (totalMinutes / 60) * wage : null;
          return (
            <div
              key={g.staffId}
              ref={(el) => {
                cardRefs.current[g.staffId] = el;
              }}
              style={{ width: 480, padding: 28, background: '#ffffff', color: '#111827', fontFamily: 'sans-serif' }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>{t('timecardScreen.imageCardTitle', { name: g.staffName })}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {storeName ? `${storeName} ・ ` : ''}
                {from} 〜 {to}
              </div>
              <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb' }}>
                {g.records.map((r) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                    <span>{fmtTime(r.clockIn)} 〜 {r.clockOut ? fmtTime(r.clockOut) : t('timecardScreen.workingParen')}</span>
                    <span>{fmtHours(applyTimecardRounding(workedMinutes(r), rounding))}h</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, fontSize: 14, fontWeight: 700 }}>
                {t('timecardScreen.imageTotalWorked', { hours: fmtHours(totalMinutes) })}
                {cost !== null && ` ・ ${t('timecardScreen.imageEstimatedCost', { cost: cost.toFixed(2) })}`}
              </div>
              <div style={{ marginTop: 10, fontSize: 10, color: '#9ca3af' }}>{t('timecardScreen.imageGeneratedAt', { datetime: new Date().toLocaleString('ja-JP') })}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TimecardEditForm({ record, onDone, onCancel }: { record: TimecardRecord; onDone: () => void; onCancel: () => void }) {
  const { t } = useLanguage();
  const [clockInValue, setClockInValue] = useState(toLocalInputValue(record.clockIn));
  const [clockOutValue, setClockOutValue] = useState(toLocalInputValue(record.clockOut));
  const [note, setNote] = useState(record.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateTimecard(record.id, {
        clockIn: clockInValue ? new Date(clockInValue).toISOString() : undefined,
        clockOut: clockOutValue ? new Date(clockOutValue).toISOString() : null,
        note: note.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof PosTimecardApiError ? err.message : t('timecardScreen.editSaveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5 print:hidden">
      <div className="flex flex-wrap gap-2.5">
        <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
          {t('timecardScreen.clockInFieldLabel')}
          <input type="datetime-local" value={clockInValue} onChange={(e) => setClockInValue(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-[12.5px]" />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
          {t('timecardScreen.clockOutFieldLabel')}
          <input type="datetime-local" value={clockOutValue} onChange={(e) => setClockOutValue(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-[12.5px]" />
        </label>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('timecardScreen.editNotePlaceholder')}
        className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]"
      />
      {error && <div className="text-[11.5px] text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="h-9 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60">
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button onClick={onCancel} className="h-9 rounded-lg border border-border px-3.5 text-[12px] font-semibold">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
