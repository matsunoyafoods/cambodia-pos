'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  clockIn,
  clockOut,
  deleteTimecard,
  endBreak,
  getTimecardStatus,
  listTimecards,
  PosTimecardApiError,
  startBreak,
  updateTimecard,
  type MyTimecardStatus,
} from '@/lib/timecard-client';
import { getStaffRoster, listStaff, type PosStaffMember, type PosStaffRosterEntry } from '@/lib/staff-client';
import type { TimecardRecord } from '@/lib/pos-types';

// 勤怠打刻画面 (2026-08-31 追加。「人件費に関しては出勤、休憩、退勤は記録できるように」)。
// シフト作成機能は無し。誰でも自分の打刻ができ (staff 権限含む)、manager 以上には
// 全スタッフの勤怠レポート (期間・時給から人件費を概算) と手動修正・削除の機能を追加で出す。
// 2026-09-01: レジ横の共有端末を想定し、打刻対象スタッフをプルダウンで選べるようにした
// (Tom「打刻についてプルダウンでスタッフを選べるようにしてください」)。ログインしたまま
// 端末を共有し、出勤する本人がプルダウンで自分の名前を選んで打刻する運用を想定している。

const STATUS_LABEL: Record<MyTimecardStatus['status'], string> = {
  not_clocked_in: '未出勤',
  working: '勤務中',
  on_break: '休憩中',
  clocked_out: '退勤済み',
};

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
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = me.role === 'owner' || me.role === 'manager';

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3 print:hidden">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← レジ画面へ
        </button>
        <div className="text-[15px] font-bold">勤怠</div>
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
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
      <p className="mb-2 font-bold">POS PINログインが必要です</p>
      <p className="mb-3 text-[13px] leading-relaxed">
        経費・勤怠は現在、POS PINログイン (スタッフ選択 + PINでのログイン) をした端末専用です。matsunoya-dine
        (Telegram) のログインだけではこの画面のデータは扱えません。
      </p>
      <a
        href="/login"
        className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md"
      >
        PINでログインする
      </a>
    </div>
  );
}

function PunchCard() {
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
      .catch((err) => setError(err instanceof PosTimecardApiError ? err.message : '勤怠状態の取得に失敗しました'));
  }, [selectedStaffId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedName = roster.find((r) => r.id === selectedStaffId)?.display_name ?? me.display_name;

  async function run(actionLabel: string, action: (staffId: string) => Promise<void>) {
    if (!confirm(`${selectedName} として「${actionLabel}」を打刻しますか？`)) return;
    setBusy(true);
    setError(null);
    try {
      await action(selectedStaffId);
      load();
    } catch (err) {
      setError(err instanceof PosTimecardApiError ? err.message : '操作に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  const s = status?.status ?? null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="text-[13.5px] font-semibold">打刻するスタッフ</div>
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
            {STATUS_LABEL[s]}
          </span>
        )}
      </div>

      {status?.timecard && (
        <div className="mb-3 text-[12.5px] text-muted-foreground">出勤: {fmtTime(status.timecard.clockIn)}</div>
      )}

      {error && <div className="mb-2 text-[12.5px] text-destructive">{error}</div>}

      <div className="flex flex-wrap gap-2.5">
        <button
          disabled={busy || s !== 'not_clocked_in'}
          onClick={() => run('出勤', (id) => clockIn(id))}
          className="h-11 rounded-lg bg-primary px-5 text-[13.5px] font-bold text-primary-foreground disabled:opacity-40"
        >
          出勤
        </button>
        <button
          disabled={busy || s !== 'working'}
          onClick={() => run('休憩開始', (id) => startBreak(id))}
          className="h-11 rounded-lg border border-border px-5 text-[13.5px] font-bold disabled:opacity-40"
        >
          休憩開始
        </button>
        <button
          disabled={busy || s !== 'on_break'}
          onClick={() => run('休憩終了', (id) => endBreak(id))}
          className="h-11 rounded-lg border border-border px-5 text-[13.5px] font-bold disabled:opacity-40"
        >
          休憩終了
        </button>
        <button
          disabled={busy || (s !== 'working' && s !== 'on_break')}
          onClick={() => run('退勤', (id) => clockOut(id))}
          className="h-11 rounded-lg border border-destructive px-5 text-[13.5px] font-bold text-destructive disabled:opacity-40"
        >
          退勤
        </button>
      </div>
    </div>
  );
}

function TimecardReport() {
  const me = useStaff();
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + '01'); // 今月1日
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<TimecardRecord[] | null>(null);
  const [staffList, setStaffList] = useState<PosStaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([listTimecards({ from, to }), listStaff()])
      .then(([timecards, { staff }]) => {
        setRows(timecards);
        setStaffList(staff);
      })
      .catch((err) => setError(err instanceof PosTimecardApiError ? err.message : '勤怠レポートの取得に失敗しました'));
  }, [from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wageById = useMemo(() => new Map(staffList.map((s) => [s.id, s.hourly_wage_usd ?? null])), [staffList]);

  const totals = useMemo(() => {
    if (!rows) return { minutes: 0, cost: 0 };
    let minutes = 0;
    let cost = 0;
    for (const r of rows) {
      const m = workedMinutes(r);
      minutes += m;
      const wage = wageById.get(r.staffId);
      if (wage) cost += (m / 60) * wage;
    }
    return { minutes, cost };
  }, [rows, wageById]);

  async function handleDelete(id: string) {
    if (!confirm('この勤怠記録を削除しますか？')) return;
    try {
      await deleteTimecard(id);
      load();
    } catch (err) {
      setError(err instanceof PosTimecardApiError ? err.message : '削除に失敗しました');
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-0 print:p-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 print:hidden">
        <div className="text-[13.5px] font-semibold">勤怠レポート (人件費)</div>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <span className="text-[12px] text-muted-foreground">〜</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <button onClick={load} className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold">
            更新
          </button>
          <button
            onClick={() => printReport(`勤怠レポート_${from}_${to}`)}
            disabled={!rows || rows.length === 0}
            className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            PDF出力
          </button>
        </div>
      </div>

      {/* 印刷時のみ表示するヘッダー (店名・期間・出力日時) */}
      <div className="hidden print:mb-4 print:block">
        <div className="text-[16px] font-bold">勤怠レポート (人件費){me.store_name ? ` — ${me.store_name}` : ''}</div>
        <div className="text-[12px] text-muted-foreground">
          対象期間: {from} 〜 {to} ・ 出力日時: {new Date().toLocaleString('ja-JP')}
        </div>
      </div>

      {error && <div className="mb-2 text-[12.5px] text-destructive print:hidden">{error}</div>}

      {rows && (
        <div className="mb-3 flex gap-5 rounded-lg bg-secondary/40 px-4 py-2.5 text-[12.5px] print:rounded-none print:bg-transparent print:px-0">
          <div>
            合計実働時間: <span className="font-semibold">{fmtHours(totals.minutes)} 時間</span>
          </div>
          <div>
            概算人件費: <span className="font-semibold">${totals.cost.toFixed(2)}</span>
            <span className="ml-1 text-[11px] text-muted-foreground">(時給未設定のスタッフは含まれません)</span>
          </div>
        </div>
      )}

      {!rows && <div className="text-[12.5px] text-muted-foreground">読み込み中…</div>}
      {rows?.length === 0 && <div className="text-[12.5px] text-muted-foreground">この期間の勤怠記録はありません。</div>}

      <div className="flex flex-col gap-2 print:gap-1.5">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-lg border border-border px-3.5 py-2.5 print:rounded-none print:border-0 print:border-b print:px-0 print:py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px]">
                <span className="font-semibold">{r.staffName}</span>
                <span className="ml-2 text-muted-foreground">
                  {fmtTime(r.clockIn)} 〜 {fmtTime(r.clockOut)}
                </span>
                {!r.clockOut && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 print:hidden">勤務中</span>}
              </div>
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span>実働 {fmtHours(workedMinutes(r))}h</span>
                {r.breaks.length > 0 && <span>休憩{r.breaks.length}回</span>}
                {r.editedAt && <span className="text-amber-600">修正済み</span>}
                <button onClick={() => setEditingId((v) => (v === r.id ? null : r.id))} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold print:hidden">
                  修正
                </button>
                <button onClick={() => handleDelete(r.id)} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-destructive print:hidden">
                  削除
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
            {r.note && <div className="mt-1.5 text-[11.5px] text-muted-foreground">メモ: {r.note}</div>}
          </div>
        ))}
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
      setError(err instanceof PosTimecardApiError ? err.message : '修正の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5 print:hidden">
      <div className="flex flex-wrap gap-2.5">
        <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
          出勤時刻
          <input type="datetime-local" value={clockInValue} onChange={(e) => setClockInValue(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-[12.5px]" />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
          退勤時刻 (未退勤のままにするなら空欄)
          <input type="datetime-local" value={clockOutValue} onChange={(e) => setClockOutValue(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-[12.5px]" />
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="修正メモ (任意。押し忘れの理由など)" className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
      {error && <div className="text-[11.5px] text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="h-9 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60">
          {saving ? '保存中…' : '保存'}
        </button>
        <button onClick={onCancel} className="h-9 rounded-lg border border-border px-3.5 text-[12px] font-semibold">
          キャンセル
        </button>
      </div>
    </div>
  );
}
