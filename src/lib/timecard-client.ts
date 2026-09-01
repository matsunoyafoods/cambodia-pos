/**
 * 勤怠 (出勤・休憩・退勤) の同一オリジン API クライアント。
 * (2026-08-31 追加。データ収集・AI分析機能: 人件費の記録)
 *
 * シフト作成機能は無し。実際に打刻された出勤/休憩/退勤の記録のみ。
 * どのスタッフ (staff 権限含む全員) も自分の打刻はできるが、他人の打刻の閲覧・修正・削除は
 * manager 以上のみ (人件費 = 給与に関わる情報のため)。
 */

import type { TimecardRecord, TimecardStatus, TimecardBreak } from '@/lib/pos-types';

export class PosTimecardApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosTimecardApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new PosTimecardApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

// ---------- 打刻 (staff 以上) ----------
// 2026-09-01: 共有端末 (レジ横のタブレット等) で、ログイン中の本人以外もプルダウンで選んで
// 打刻できるようにするため、全関数が任意で対象スタッフID (staffId) を受け取れるようにした。
// 省略時は従来通りログイン中の本人。

export type MyTimecardStatus = {
  status: TimecardStatus;
  timecard: { id: string; clockIn: string; breaks: TimecardBreak[] } | null;
};

export function getTimecardStatus(staffId?: string): Promise<MyTimecardStatus> {
  const qs = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  return request(`/api/timecards/status${qs}`);
}

// 以下4つのアクションはレスポンスの詳細を使わず、呼び出し側は成功したら getTimecardStatus() で
// 状態を取り直す想定 (API 側のレスポンス形はエンドポイントごとに素朴な snake_case のままなので、
// ここで無理に camelCase 型に整形しない)。

export async function clockIn(staffId?: string): Promise<void> {
  await request('/api/timecards/clock-in', { method: 'POST', body: JSON.stringify({ staffId }) });
}

export async function startBreak(staffId?: string): Promise<void> {
  await request('/api/timecards/break-start', { method: 'POST', body: JSON.stringify({ staffId }) });
}

export async function endBreak(staffId?: string): Promise<void> {
  await request('/api/timecards/break-end', { method: 'POST', body: JSON.stringify({ staffId }) });
}

export async function clockOut(staffId?: string): Promise<void> {
  await request('/api/timecards/clock-out', { method: 'POST', body: JSON.stringify({ staffId }) });
}

// ---------- 勤怠一覧・人件費レポート (manager 以上) ----------

export async function listTimecards(filter?: { from?: string; to?: string }): Promise<TimecardRecord[]> {
  const params = new URLSearchParams();
  if (filter?.from) params.set('from', filter.from);
  if (filter?.to) params.set('to', filter.to);
  const qs = params.toString();
  const { timecards } = await request<{ timecards: TimecardRecord[] }>(`/api/timecards${qs ? `?${qs}` : ''}`);
  return timecards;
}

export type UpdateTimecardInput = Partial<{
  clockIn: string;
  clockOut: string | null;
  breaks: TimecardBreak[];
  note: string | null;
}>;

export async function updateTimecard(id: string, patch: UpdateTimecardInput): Promise<TimecardRecord> {
  const { timecard } = await request<{ timecard: TimecardRecord }>(`/api/timecards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return timecard;
}

export async function deleteTimecard(id: string): Promise<void> {
  await request(`/api/timecards/${id}`, { method: 'DELETE' });
}
