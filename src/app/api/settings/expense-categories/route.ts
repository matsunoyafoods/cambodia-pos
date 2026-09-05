import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ExpenseCategory } from '@/lib/pos-types';

// 経費項目 (雑費・仕入れ等) の候補一覧 (2026-08-31 追加。「経費は雑費や仕入れなどの項目も
// 登録して選べるようにしましょう」)。pos.expenses.category は自由文字列のスナップショットの
// ままで、このマスタは入力フォームの候補一覧として使う (決済方法と同じ方針)。

function toCategory(row: { id: string; name: string; sort_order: number }): ExpenseCategory {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}

// 一覧。staff 以上で閲覧可 (経費入力は誰でもできるため候補一覧も見える必要がある)。
export const GET = withPosStaff('part_time', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('expense_categories')
    .select('id, name, sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: (data ?? []).map(toCategory) });
});

// 2026-09-05: 上限を60→160に拡大。Tomの実データ (例: 相殺勘定の複数名併記など) には
// 60文字を超える名前があり、まとめて登録した際に超過するものがあったため。
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
    .from('expense_categories')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('expense_categories')
    .insert({ store_id: storeId, name: parsed.data.name, sort_order: nextSortOrder })
    .select('id, name, sort_order')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: toCategory(data) }, { status: 201 });
});
