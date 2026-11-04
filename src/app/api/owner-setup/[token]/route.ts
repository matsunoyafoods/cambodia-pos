import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { hashPin } from '@/lib/pos-auth';

// 新規店舗オーナーの初回POS PIN設定 (契約店舗管理画面=cambodia-pos-adminがメールで送る
// セットアップリンク先)。contract-management-addendum-2026-11 参照。
// 認証なし公開API (ログイン前提の仕組みのため)。トークン自体が一度しか使えない
// 使い捨てのため、token を知っている = 本人、という前提で成立する (matsunoya-dine の
// staff_invite/[token] と同じ考え方)。

type TokenRow = {
  id: string;
  store_id: string;
  token: string;
  contact_name: string | null;
  expires_at: string;
  used_at: string | null;
};

async function loadValidToken(token: string): Promise<
  | { ok: true; row: TokenRow; storeName: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' }
> {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: row } = await supabase
    .from('owner_setup_tokens')
    .select('id, store_id, token, contact_name, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  // トークンが存在しない、または別店舗向けのトークンをこのデプロイで開いた場合は
  // 同じ 'not_found' として扱う (他店舗にトークンの存在自体を漏らさない)。
  if (!row || row.store_id !== storeId) {
    return { ok: false, reason: 'not_found' };
  }
  if (row.used_at) {
    return { ok: false, reason: 'used' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle();
  return { ok: true, row, storeName: store?.name ?? '' };
}

// トークンの有効性確認 (画面表示用)。
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadValidToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json({ storeName: result.storeName, contactName: result.row.contact_name });
}

const setupSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN は4〜8桁の数字で入力してください'),
});

// オーナーPINの確定。成功したら pos.staff (role: owner) を1件作成し、トークンを使い捨てる。
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadValidToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = setupSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const pinHash = await hashPin(parsed.data.pin);

  const { data: staff, error } = await supabase
    .from('staff')
    .insert({ store_id: storeId, display_name: parsed.data.displayName, role: 'owner', pin_hash: pinHash })
    .select('id, display_name, role')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? 'display_name_taken' : error.message;
    return NextResponse.json({ error: message }, { status });
  }

  // トークンを使い捨てる (このリクエストが初回成功のみ。再利用防止)。
  await supabase.from('owner_setup_tokens').update({ used_at: new Date().toISOString() }).eq('id', result.row.id);

  return NextResponse.json({ staff }, { status: 201 });
}
