import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { ETHNICITY_KEYS } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

// z.record(z.enum(...), ...) requires EVERY enum key to be present (exhaustive) in this zod version —
// the client only sends keys the staff actually tapped (a partial object), so that would reject every
// real request. z.partialRecord allows a subset of keys while still rejecting unknown keys.
const guestEthnicitySchema = z.partialRecord(z.enum(ETHNICITY_KEYS), z.number().int().min(0).max(999));

const postSchema = z.object({
  guestEthnicity: guestEthnicitySchema,
  guestKidsCount: z.number().int().min(0).max(999),
  staffId: z.string().uuid().optional(),
});

const orderSelect = 'id, table_code, status, guest_ethnicity, guest_kids_count, guest_recorded_at, created_at';

// POST /api/pos-order/orders/[id]/guest : 客層記録 (人種構成・子供人数)。
// 2026-08-31 変更 (Tomさんの要望): 以前はこの卓の open 注文を作る瞬間 (ファースト注文確定時)
// に必須入力だったが、「あとで人数が増えた場合にも対応できる」「会計の時だと少し余裕がある」
// という理由で、レジ画面が「会計へ進む」を押したタイミングに移動した (pos-app.tsx の
// handleCheckout 参照)。会計完了 (complete) 前であればいつでも呼べる。認証なし (他の
// pos-order/* ルートと同じ理由)。ハンディ (会計機能を持たない) からはこのAPIを呼ばない。
export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { guestEthnicity, guestKidsCount, staffId } = parsed.data;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (order.status !== 'open') {
    return NextResponse.json({ error: 'この注文は既に会計済み・取消済みです' }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('orders')
    .update({
      guest_ethnicity: guestEthnicity,
      guest_kids_count: guestKidsCount,
      guest_recorded_by: staffId ?? null,
      guest_recorded_at: nowIso,
    })
    .eq('id', id)
    .select(orderSelect)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ order: data });
}
