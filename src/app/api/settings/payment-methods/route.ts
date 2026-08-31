import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PaymentMethodConfig } from '@/lib/pos-types';

// 決済方法の管理 (設定画面「決済設定」タブ用) (2026-08-31 追加。「決済設定で決済方法を
// 追加できるようにしてください」)。従来の現金/QR/カード固定3択トグルを廃止し、店舗が自由に
// 名前を付けて決済方法を追加・並び替え・無効化できるようにする。

function toConfig(row: {
  id: string;
  name: string;
  is_cash: boolean;
  enabled: boolean;
  sort_order: number;
}): PaymentMethodConfig {
  return { id: row.id, name: row.name, isCash: row.is_cash, enabled: row.enabled, sortOrder: row.sort_order };
}

// 一覧 (無効化されたものも含む。管理画面用)。staff 以上で閲覧可。
export const GET = withPosStaff('staff', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('payment_methods')
    .select('id, name, is_cash, enabled, sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ paymentMethods: (data ?? []).map(toConfig) });
});

const postSchema = z.object({
  name: z.string().trim().min(1).max(40),
  isCash: z.boolean().default(false),
});

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
    .from('payment_methods')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('payment_methods')
    .insert({ store_id: storeId, name: parsed.data.name, is_cash: parsed.data.isCash, sort_order: nextSortOrder })
    .select('id, name, is_cash, enabled, sort_order')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ paymentMethod: toConfig(data) });
});
