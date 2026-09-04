import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

type Row = {
  id: string;
  reservation_type: string;
  customer_name: string;
  phone: string | null;
  party_size: number | null;
  reservation_date: string;
  reservation_time: string | null;
  details: Record<string, string> | null;
  notes: string | null;
  status: string;
  created_by_name: string | null;
  created_at: string;
};

function toApi(row: Row) {
  return {
    id: row.id,
    reservationType: row.reservation_type,
    customerName: row.customer_name,
    phone: row.phone,
    partySize: row.party_size,
    reservationDate: row.reservation_date,
    reservationTime: row.reservation_time,
    details: row.details ?? {},
    notes: row.notes,
    status: row.status,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    source: 'pos' as const,
  };
}

const updateSchema = z.object({
  status: z.enum(['confirmed', 'cancelled']),
});

// 現状はキャンセル(status切替)のみ対応。電話等でのキャンセル連絡を受けたときに使う。
export const PATCH = withPosStaff('part_time', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  // 'app:' プレフィックスは matsunoya-dine 側 (public.reservations) の予約を読み取り専用で
  // マージ表示しているだけの仮想ID。ここでは書き込めない (2026-08-31 追加)。
  if (id.startsWith('app:')) {
    return NextResponse.json({ error: 'アプリ予約はPOSからは編集できません' }, { status: 400 });
  }
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const { data, error } = await supabase
    .from('reservations')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('store_id', storeId)
    .select(
      'id, reservation_type, customer_name, phone, party_size, reservation_date, reservation_time, details, notes, status, created_by_name, created_at',
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toApi(data as Row));
});
