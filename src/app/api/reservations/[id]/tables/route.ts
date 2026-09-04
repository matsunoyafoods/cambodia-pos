import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  tableCodes: z.array(z.string().trim().min(1).max(20)).max(20),
});

// 予約の卓割り当て (2026-09-02 追加。Tom「予約からどこの席を何時から使うという設定ができて、
// 設定した席に予約マークがついて何時から予約かが分かるように」への対応)。
// POS電話予約・matsunoya-dineアプリ予約のどちらも同じ id 空間 (ApiReservation.id) で扱える
// 別テーブル (pos.reservation_table_assignments) に upsert する。時間は予約自体が持っている
// reservation_time / reserved_at をそのまま使うので、ここでは卓コードの配列だけを保存する。
export const PATCH = withPosStaff('part_time', async (session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const { data, error } = await supabase
    .from('reservation_table_assignments')
    .upsert(
      {
        store_id: storeId,
        reservation_ref: id,
        table_codes: parsed.data.tableCodes,
        updated_by_name: session.displayName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id,reservation_ref' },
    )
    .select('reservation_ref, table_codes')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id, tableCodes: (data.table_codes as string[] | null) ?? [] });
});
