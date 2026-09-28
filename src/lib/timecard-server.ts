import 'server-only';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import type { PosStaffSessionPayload } from '@/lib/pos-auth';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';

// 打刻対象スタッフの解決 (2026-09-01 追加)。
// Tom の要望「打刻についてプルダウンでスタッフを選べるようにしてください」への対応。
// 共有端末 (レジ横のタブレット等) にログインしたまま、出勤するスタッフ本人ではなく
// 画面を操作している人がプルダウンで対象スタッフを選んで打刻できるようにする。
// リクエストに staffId が指定されなければ従来通りログイン中の本人 (session.staffId) を使う。
// 指定された場合は、その staffId が自店舗の pos.staff に実在し有効であることを必ず確認してから
// 使う (他店舗のUUIDを渡されても弾く。§3.5 の store_id 分離方針に沿った検証)。
export async function resolveTargetStaffId(
  session: PosStaffSessionPayload,
  requestedStaffId: string | null | undefined,
): Promise<{ staffId: string; error?: undefined } | { staffId?: undefined; error: string }> {
  if (!requestedStaffId || requestedStaffId === session.staffId) {
    return { staffId: session.staffId };
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('id', requestedStaffId)
    .eq('store_id', storeId)
    .eq('active', true)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: '指定されたスタッフが見つかりません' };
  return { staffId: data.id };
}

// ---------- 本日の打刻履歴の「本日」判定 (2026-09-28 追加) ----------
// Tom「出勤・退勤の履歴が同じ画面に残るように、その履歴表示は設定した時間に消えるように
// してほしい」への対応。打刻の実データ (pos.timecards) は一切削除しない。あくまで画面表示の
// フィルタ条件 (「本日」の起点) を店舗設定 timecardHistoryResetTime (HH:MM) に従って計算する。
// api/timecards/status (個人の履歴) と api/timecards/today (2026-09-28 追加。manager 以上向け、
// 全スタッフの履歴) の両方から使う共有ロジック。

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

export function todayPhnomPenh(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** 設定された HH:MM の直近の発生時刻 (現在時刻以下で最も新しいもの) を ISO で返す。 */
export function historyWindowStartIso(resetTime: string): string {
  const date = todayPhnomPenh();
  const candidate = new Date(`${date}T${resetTime}:00+07:00`);
  if (candidate.getTime() <= Date.now()) return candidate.toISOString();
  const prevDate = new Date(candidate.getTime() - 24 * 60 * 60 * 1000);
  const prevDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(prevDate);
  return new Date(`${prevDateStr}T${resetTime}:00+07:00`).toISOString();
}

/** pos.stores.settings.timecardHistoryResetTime を読む (未設定ならデフォルト '00:00')。 */
export async function getTimecardHistoryResetTime(
  supabase: ReturnType<typeof createPosAdminClient>,
  storeId: string,
): Promise<string> {
  const { data: storeRow } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  const settings = storeRow?.settings;
  if (settings && typeof settings === 'object' && typeof (settings as Record<string, unknown>).timecardHistoryResetTime === 'string') {
    return (settings as Record<string, unknown>).timecardHistoryResetTime as string;
  }
  return DEFAULT_SETTINGS.timecardHistoryResetTime;
}
