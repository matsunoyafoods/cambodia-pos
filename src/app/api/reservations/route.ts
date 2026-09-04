import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createDineAdminClient, createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { notifyReservationCreated } from '@/lib/telegram-notify';

// 予約受付機能。日々の電話予約はスタッフなら誰でも受け付けられる業務なので
// (テーブルレイアウトのような構造変更とは違い) staff 以上で読み書きどちらも許可する。
//
// 2026-08-31: matsunoya-dine アプリ (Telegram) 経由の予約 (public.reservations) を、この一覧に
// 読み取り専用でマージして表示するようにした (「アプリで予約した時にPOSレジに反映されるように
// なっているのか？」「連携をご希望です」)。書き込みは行わない — Source of Truth は引き続き
// matsunoya-dine 側。pos.integrations.dine_store_id が未設定の店舗 (dine連携していない店舗) は
// 従来通り pos.reservations のみを表示する。

type PosRow = {
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

type ApiReservation = {
  id: string;
  reservationType: string;
  customerName: string;
  phone: string | null;
  partySize: number | null;
  reservationDate: string;
  reservationTime: string | null;
  details: Record<string, string>;
  notes: string | null;
  status: 'confirmed' | 'cancelled';
  createdByName: string | null;
  createdAt: string;
  /** 'pos' = POSで直接受け付けた電話予約 (編集・キャンセル可能)。'app' = アプリ予約 (表示のみ、読み取り専用) */
  source: 'pos' | 'app';
  /** 割り当てられた卓コード (2026-09-02 追加、pos.reservation_table_assignments 由来)。未割当は [] */
  tableCodes: string[];
};

function toApiFromPos(row: PosRow): ApiReservation {
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
    status: row.status as 'confirmed' | 'cancelled',
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    source: 'pos',
    tableCodes: [],
  };
}

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

function splitReservedAt(reservedAt: string): { date: string; time: string } {
  const d = new Date(reservedAt);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return { date, time };
}

type DineReservationRow = {
  id: string;
  customer_user_id: string | null;
  reservation_no: string;
  status: string;
  reserved_at: string;
  party_size: number | null;
  purpose: string | null;
  customer_notes: string | null;
  created_at: string;
};

async function fetchAppReservations(): Promise<ApiReservation[]> {
  const posSupabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: integration } = await posSupabase
    .from('integrations')
    .select('dine_store_id')
    .eq('store_id', storeId)
    .maybeSingle();
  const dineStoreId = integration?.dine_store_id;
  if (!dineStoreId) return [];

  const dineSupabase = createDineAdminClient();
  // 過去の完了済み予約で一覧が埋まらないよう、直近 (昨日以降) のものだけ表示する。
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await dineSupabase
    .from('reservations')
    .select('id, customer_user_id, reservation_no, status, reserved_at, party_size, purpose, customer_notes, created_at')
    .eq('store_id', dineStoreId)
    .is('deleted_at', null)
    .gte('reserved_at', since)
    .order('reserved_at', { ascending: true });
  if (error || !data) return [];

  const rows = data as DineReservationRow[];
  const userIds = Array.from(new Set(rows.map((r) => r.customer_user_id).filter((id): id is string => !!id)));
  const usersById = new Map<string, { display_name: string | null; phone: string | null }>();
  if (userIds.length > 0) {
    const { data: users } = await dineSupabase.from('users').select('id, display_name, phone').in('id', userIds);
    for (const u of users ?? []) {
      usersById.set(u.id as string, { display_name: u.display_name as string | null, phone: u.phone as string | null });
    }
  }

  return rows.map((r) => {
    const { date, time } = splitReservedAt(r.reserved_at);
    const user = r.customer_user_id ? usersById.get(r.customer_user_id) : undefined;
    const status: 'confirmed' | 'cancelled' = r.status === 'cancelled' || r.status === 'no_show' ? 'cancelled' : 'confirmed';
    return {
      id: `app:${r.id}`,
      reservationType: 'normal',
      customerName: user?.display_name || `アプリ予約 (${r.reservation_no})`,
      phone: user?.phone ?? null,
      partySize: r.party_size,
      reservationDate: date,
      reservationTime: time,
      details: {},
      notes: [r.purpose, r.customer_notes].filter(Boolean).join(' / ') || null,
      status,
      createdByName: null,
      createdAt: r.created_at,
      source: 'app',
      tableCodes: [],
    };
  });
}

async function fetchTableAssignments(storeId: string): Promise<Map<string, string[]>> {
  const supabase = createPosAdminClient();
  const { data } = await supabase
    .from('reservation_table_assignments')
    .select('reservation_ref, table_codes')
    .eq('store_id', storeId);
  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    map.set(row.reservation_ref as string, ((row.table_codes as string[] | null) ?? []) as string[]);
  }
  return map;
}

export const GET = withPosStaff('part_time', async () => {
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

  const posItems = (data ?? []).map((row) => toApiFromPos(row as PosRow));
  const appItems = await fetchAppReservations().catch(() => []);
  const tableCodesByRef = await fetchTableAssignments(storeId).catch(() => new Map<string, string[]>());

  const items = [...posItems, ...appItems]
    .map((item) => ({ ...item, tableCodes: tableCodesByRef.get(item.id) ?? [] }))
    .sort((a, b) => {
      const ad = a.reservationDate + (a.reservationTime ?? '');
      const bd = b.reservationDate + (b.reservationTime ?? '');
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

  return NextResponse.json({ items });
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

export const POST = withPosStaff('part_time', async (session, req) => {
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

  const created = toApiFromPos(data as PosRow);
  notifyReservationCreated({
    reservationType: created.reservationType,
    customerName: created.customerName,
    phone: created.phone,
    partySize: created.partySize,
    reservationDate: created.reservationDate,
    reservationTime: created.reservationTime,
    notes: created.notes,
    createdByName: session.displayName,
  }).catch(() => {});

  return NextResponse.json(created);
});
