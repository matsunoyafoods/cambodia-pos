import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PNG } from 'pngjs';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ReceiptFormatSettings } from '@/lib/pos-types';

// レシート・領収書に印字する店舗ロゴ画像 (2026-08-31 追加。「ロゴを登録してレシートや
// 領収書にロゴ印刷できるようにしたい」)。PNG (base64、data:URLプレフィックス無し) を
// pos.stores.settings.receiptFormat.logoPngBase64 (jsonb) にそのまま保存し、印字時に
// escpos-logo.ts でプリンターごとの用紙幅に合わせてESC/POSラスターコマンドへ変換する
// (新規マイグレーション不要、printAgentToken と同じ場所に別キーで同居させる)。

type StoredSettings = { receiptFormat?: Partial<ReceiptFormatSettings> };

// jsonb 1行に収める都合上、大きすぎる画像は弾く (300KB ≒ base64で400KB強)。
// ロゴは元々小さいモノクロ寄りの画像想定なので、通常の運用では十分な上限。
const MAX_LOGO_BYTES = 300 * 1024;

export const GET = withPosStaff('part_time', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stored = (data?.settings && typeof data.settings === 'object' ? data.settings : {}) as StoredSettings;
  return NextResponse.json({ logoPngBase64: stored.receiptFormat?.logoPngBase64 ?? null });
});

const postSchema = z.object({
  // data:image/png;base64,.... 形式でもプレフィックス無しの base64 単体でもどちらでも受け付ける。
  pngBase64: z.string().min(1),
});

export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const raw = parsed.data.pngBase64.replace(/^data:image\/png;base64,/, '');

  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return NextResponse.json({ error: 'base64のデコードに失敗しました' }, { status: 400 });
  }
  if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: `画像は${Math.floor(MAX_LOGO_BYTES / 1024)}KB以下のPNGにしてください` }, { status: 400 });
  }
  try {
    PNG.sync.read(buf); // 破損PNG・非PNGファイルをここで弾く
  } catch {
    return NextResponse.json({ error: 'PNG画像として読み込めませんでした。PNG形式の画像を選んでください' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: readError } = await supabase
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as Record<
    string,
    unknown
  >;
  const currentReceiptFormat = (current.receiptFormat && typeof current.receiptFormat === 'object'
    ? current.receiptFormat
    : {}) as Partial<ReceiptFormatSettings>;
  const merged = {
    ...current,
    receiptFormat: { ...currentReceiptFormat, logoPngBase64: raw },
  };

  const { error } = await supabase
    .from('stores')
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

export const DELETE = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: readError } = await supabase
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as Record<
    string,
    unknown
  >;
  const currentReceiptFormat = (current.receiptFormat && typeof current.receiptFormat === 'object'
    ? current.receiptFormat
    : {}) as Partial<ReceiptFormatSettings>;
  const merged = {
    ...current,
    receiptFormat: { ...currentReceiptFormat, logoPngBase64: null },
  };

  const { error } = await supabase
    .from('stores')
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
