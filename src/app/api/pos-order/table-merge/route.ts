import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// 会計合算: 複数テーブルの開いている伝票を1つに合算する (2026-08-31 追加。
// 「会計を他の席と合算にする時はどうしたらいいの？」)。
//   - 合算元 (sourceTableCodes) の注文品目 (pos.order_items) を全て合算先 (targetTableCode) の
//     伝票へ付け替える。
//   - 客層記録 (guest_ethnicity/guest_kids_count) も合算先へ合算する (日報の客数集計が
//     合算後も正しくなるように)。
//   - 合算元の伝票は status='void' にし、テーブルのセッション(滞在タイマー)を削除して
//     テーブルを空ける。
//   - 合算元・合算先どちらの伝票にも既に設定されていた割引・クーポンはこの操作では引き継がない
//     (合算後、必要なら会計画面で改めて割引を設定する)。
// 認証なしは他の /api/pos-order/* と同じ理由。

const postSchema = z.object({
  targetTableCode: z.string().min(1),
  sourceTableCodes: z.array(z.string().min(1)).min(1),
});

type GuestEthnicity = Partial<Record<string, number>>;

function mergeEthnicity(a: GuestEthnicity, b: GuestEthnicity): GuestEthnicity {
  const out: GuestEthnicity = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { targetTableCode, sourceTableCodes } = parsed.data;
  const sources = Array.from(new Set(sourceTableCodes.filter((c) => c !== targetTableCode)));
  if (sources.length === 0) {
    return NextResponse.json({ error: '合算するテーブルを選んでください' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: targetOrder, error: targetError } = await supabase
    .from('orders')
    .select('id, guest_ethnicity, guest_kids_count')
    .eq('store_id', storeId)
    .eq('table_code', targetTableCode)
    .eq('status', 'open')
    .maybeSingle();
  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 500 });
  if (!targetOrder) return NextResponse.json({ error: '合算先のテーブルに開いている伝票がありません' }, { status: 400 });

  let mergedEthnicity = (targetOrder.guest_ethnicity ?? {}) as GuestEthnicity;
  let mergedKidsCount = targetOrder.guest_kids_count ?? 0;
  let mergedCount = 0;
  const skipped: string[] = [];

  for (const code of sources) {
    const { data: sourceOrder, error: sourceError } = await supabase
      .from('orders')
      .select('id, guest_ethnicity, guest_kids_count')
      .eq('store_id', storeId)
      .eq('table_code', code)
      .eq('status', 'open')
      .maybeSingle();
    if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 });
    if (!sourceOrder) {
      skipped.push(code);
      continue;
    }

    const { error: moveItemsError } = await supabase
      .from('order_items')
      .update({ order_id: targetOrder.id })
      .eq('order_id', sourceOrder.id);
    if (moveItemsError) return NextResponse.json({ error: moveItemsError.message }, { status: 500 });

    mergedEthnicity = mergeEthnicity(mergedEthnicity, (sourceOrder.guest_ethnicity ?? {}) as GuestEthnicity);
    mergedKidsCount += sourceOrder.guest_kids_count ?? 0;

    const { error: voidError } = await supabase.from('orders').update({ status: 'void' }).eq('id', sourceOrder.id);
    if (voidError) return NextResponse.json({ error: voidError.message }, { status: 500 });

    const { error: sessionError } = await supabase
      .from('table_sessions')
      .delete()
      .eq('store_id', storeId)
      .eq('table_code', code);
    if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

    mergedCount += 1;
  }

  if (mergedCount > 0) {
    const { error: updateTargetError } = await supabase
      .from('orders')
      .update({ guest_ethnicity: mergedEthnicity, guest_kids_count: mergedKidsCount })
      .eq('id', targetOrder.id);
    if (updateTargetError) return NextResponse.json({ error: updateTargetError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mergedCount, skipped });
}
