import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const BUCKET = 'store-media';
const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const SELECT_COLUMNS = 'id, category_id, name, price, active, sort_order, image_url';

// 商品画像のアップロード (Supabase Storage の public バケット store-media に保存)。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: existing, error: findError } = await supabase
    .from('menu_items')
    .select('id')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: '画像ファイルが見つかりません' }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: 'jpg・png・webp のいずれかの画像を選択してください' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '画像サイズは3MB以下にしてください' }, { status: 400 });
  }

  const path = `pos-menu-items/${storeId}/${id}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type,
    upsert: true,
  });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // upsert で同じパスに再アップロードすると CDN/ブラウザキャッシュが古い画像を返すことがあるため、
  // 保存するURLにキャッシュバスター (更新時刻) を付与する。
  const imageUrl = `${pub.publicUrl}?v=${Date.now()}`;

  const { data, error } = await supabase
    .from('menu_items')
    .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('store_id', storeId)
    .select(SELECT_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
});

// 商品画像の削除 (Storage のファイル自体は残しても実害が無いため、DB側の参照だけ外す)。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data, error } = await supabase
    .from('menu_items')
    .update({ image_url: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('store_id', storeId)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ item: data });
});
