import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 予約受付機能。日々の電話予約はスタッフなら誰でも受け付けられる業務なので
// (テーブルレイアウトのような構造変更とは違い) staff 以上で読み書きどちらも許可する。

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
  };
}

export const GET = withPosStaff('staff', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('reservations')
    .select(
      'id, reservation_type, customer_name, phone, party_size, reservation_date, reservation_time, details, notes, status, created_by_name, created_at',
    )
    .eq('store_id', storeId)
    .order('reservation_date')
    .order('reservation_time', { nullsFirst: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data ?? []).map((row) => toApi(row as Row)) });
});

const createSchema = z.object({
  reservationType: z.enum(['normal', 'tenderloin_block', 'birthday_room', 'group']),
  customerName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
  partySize: z.number().int().positive().max(500).optional(),
  reservationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式で入力してください'),
  reservationTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 形式で入力してください')
    .optional(),
  details: z.record(z.string(), z.string()).optional(),
  notes: z.string().max(1000).optional(),
});

export const POST = withPosStaff('staff', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      store_id: storeId,
      reservation_type: parsed.data.reservationType,
      customer_name: parsed.data.customerName,
      phone: parsed.data.phone ?? null,
      party_size: parsed.data.partySize ?? null,
      reservation_date: parsed.data.reservationDate,
      reservation_time: parsed.data.reservationTime ?? null,
      details: parsed.data.details ?? {},
      notes: parsed.data.notes ?? null,
      created_by_name: session.displayName,
    })
    .select(
      'id, reservation_type, customer_name, phone, party_size, reservation_date, reservation_time, details, notes, status, created_by_name, created_at',
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toApi(data as Row));
});
