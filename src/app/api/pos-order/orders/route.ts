import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { ETHNICITY_KEYS } from '@/lib/pos-types';

// レジ画面向け、卓の「開いている伝票 (pos.orders, status='open')」用の公開エンドポイント
// (認証なし。理由は同ディレクトリの他ルートと同じ: dine連携ログインのCookieは別オリジンの
// ためこのサーバーから見えず、withPosStaff を使うとレジ画面自体が読めなくなってしまう)。
//
// 1卓の来店 = 1つの open 注文。会計完了 (complete) で status が 'paid' になり、次の来店では
// 新しい注文が作られる。「注文確定」ボタンを押すたびに /orders/[id]/items へ商品が追記され、
// 画面をリロードしたり卓一覧に戻ってもこの GET で確定済み分を復元できる (カート消失バグの根本対応)。

const orderItemSelect = 'id, menu_id, menu_name, qty, unit_price, selected_options, line_total, sent_to_kitchen_at';
const orderSelect = 'id, table_code, status, guest_ethnicity, guest_kids_count, guest_recorded_at, created_at';

// GET /api/pos-order/orders?tableCode=T1 : その卓の open 注文と、確定済み品目を返す。無ければ order: null。
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tableCode = searchParams.get('tableCode');
  if (!tableCode) {
    return NextResponse.json({ error: 'tableCode is required' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: order, error } = await supabase
    .from('orders')
    .select(orderSelect)
    .eq('store_id', storeId)
    .eq('table_code', tableCode)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!order) return NextResponse.json({ order: null, items: [] });

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select(orderItemSelect)
    .eq('order_id', order.id)
    .order('sent_to_kitchen_at');

  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  return NextResponse.json({ order, items: items ?? [] });
}

const guestEthnicitySchema = z.record(z.enum(ETHNICITY_KEYS), z.number().int().min(0).max(999));

const createSchema = z.object({
  tableCode: z.string().min(1),
  guestEthnicity: guestEthnicitySchema,
  guestKidsCount: z.number().int().min(0).max(999),
  staffId: z.string().uuid().optional(),
});

// POST /api/pos-order/orders : ファースト注文確定時に、客層情報とともに open 注文を新規作成する。
// 既に open 注文がある卓に対して呼ばれた場合は (二重タップ等の保険として) 新規作成せず既存を返す。
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { tableCode, guestEthnicity, guestKidsCount, staffId } = parsed.data;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: existingError } = await supabase
    .from('orders')
    .select(orderSelect)
    .eq('store_id', storeId)
    .eq('table_code', tableCode)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (existing) {
    return NextResponse.json({ order: existing });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('orders')
    .insert({
      store_id: storeId,
      table_code: tableCode,
      status: 'open',
      subtotal: 0,
      vat: 0,
      service: 0,
      total: 0,
      guest_ethnicity: guestEthnicity,
      guest_kids_count: guestKidsCount,
      guest_recorded_by: staffId ?? null,
      guest_recorded_at: nowIso,
    })
    .select(orderSelect)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ order: data }, { status: 201 });
}
