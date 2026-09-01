import 'server-only';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import type { PosStaffSessionPayload } from '@/lib/pos-auth';

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
