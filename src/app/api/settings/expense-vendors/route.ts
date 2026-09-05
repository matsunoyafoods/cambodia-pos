import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ExpenseVendor } from '@/lib/pos-types';

// 経費の「よく使う仕入れ先・買い物先」の候補一覧 (2026-08-31 追加。「経費はよく買うところ
// などは登録できるようにしましょう」)。pos.expenses.vendor は自由文字列のスナップショットの
// ままで、このマスタは入力フォームの候補一覧として使う (決済方法と同じ方針)。

function toVendor(row: { id: string; name: string; sort_order: number }): ExpenseVendor {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}

// 一覧。staff 以上で閲覧可 (経費入力は誰でもできるため候補一覧も見える必要がある)。
export const GET = withPosStaff('part_time', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('expense_vendors')
    .select('id, name, sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendors: (data ?? []).map(toVendor) });
});

// 2026-09-05: 上限を60→160に拡大。Tomの実データ (例:
// 「MATSUZAKI TSUYOSHI AND MATSUZAKI YUKA AND ... (小口資金)」のような複数名併記) には
// 60文字を超える仕入れ先名があり、まとめて登録した際に超過するものがあったため。
const postSchema = z.object({ name: z.string().trim().min(1).max(160) });

// 追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: countError } = await supabase
    .from('expense_vendors')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('expense_vendors')
    .insert({ store_id: storeId, name: parsed.data.name, sort_order: nextSortOrder })
    .select('id, name, sort_order')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vendor: toVendor(data) }, { status: 201 });
});
