import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 経費のレシート写真アップロード (2026-09-01 追加。「容量を増やしました」への対応)。
// 非公開バケット expense-receipts (0017マイグレーション) に保存し、pos.expenses.receipt_image_url
// には公開URLではなく Storage 上のパス (storeId/expenseId.ext) を保存する。表示時は毎回
// signed URL を発行する (GET /api/expenses 参照) — 財務データのため恒久的な公開URLにはしない。

type RouteContext = { params: Promise<{ id: string }> };

const BUCKET = 'expense-receipts';
const MAX_BYTES = 5 * 1024 * 1024; // 5MB (スマホカメラ写真を想定)
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

// アップロード。staff 以上 (現場で立て替え購入したスタッフがその場で撮影・添付できるように、
// 経費の新規登録と同じ権限にしている)。
export const POST = withPosStaff('part_time', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: existing, error: findError } = await supabase.from('expenses').select('id, receipt_image_url').eq('id', id).eq('store_id', storeId).maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: '画像ファイルが見つかりません' }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: 'jpg・png・webp・heic のいずれかの画像を選択してください' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '画像サイズは5MB以下にしてください' }, { status: 400 });
  }

  const path = `${storeId}/${id}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type,
    upsert: true,
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { error: dbError } = await supabase.from('expenses').update({ receipt_image_url: path, updated_at: new Date().toISOString() }).eq('id', id).eq('store_id', storeId);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (signError) return NextResponse.json({ error: signError.message }, { status: 500 });

  return NextResponse.json({ receiptImageUrl: signed.signedUrl }, { status: 201 });
});

// 削除 (写真だけ外す。経費記録自体は残す)。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data, error } = await supabase.from('expenses').update({ receipt_image_url: null, updated_at: new Date().toISOString() }).eq('id', id).eq('store_id', storeId).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Storage 上のファイル自体は残しても実害が無い (menu item 画像と同じ方針) ので削除はしない。
  return NextResponse.json({ ok: true });
});
