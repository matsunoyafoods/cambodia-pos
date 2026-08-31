import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { DEFAULT_RECEIPT_FORMAT_SETTINGS, type ReceiptFormatSettings } from '@/lib/pos-types';

// レシート・領収書の印字設定 (ヘッダー・フッター文言) (2026-08-31 追加。「印字設定と
// レシートの幅設定などできるようにしないといけない」)。ロゴ画像は別ルート
// (/api/settings/receipt-logo) で扱う (画像アップロードは容量が違うため分離)。
// pos.stores.settings.receiptFormat (jsonb) に保存する (新規マイグレーション不要、
// printAgentToken と同じ場所に別キーで同居させる)。用紙幅はプリンターごとの設定
// (pos.printers.paper_width_mm) をそのまま印字時に使うので、ここには含めない。

type StoredSettings = { receiptFormat?: Partial<ReceiptFormatSettings> };

export const GET = withPosStaff('staff', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stored = (data?.settings && typeof data.settings === 'object' ? data.settings : {}) as StoredSettings;
  const receiptFormat: Omit<ReceiptFormatSettings, 'logoPngBase64'> = {
    headerText: stored.receiptFormat?.headerText ?? DEFAULT_RECEIPT_FORMAT_SETTINGS.headerText,
    footerText: stored.receiptFormat?.footerText ?? DEFAULT_RECEIPT_FORMAT_SETTINGS.footerText,
  };
  return NextResponse.json({
    ...receiptFormat,
    // ロゴの有無だけ返す (中身の base64 は無駄に大きいので、設定画面のプレビューは
    // 別途 GET /api/settings/receipt-logo で取得する)。
    hasLogo: Boolean(stored.receiptFormat?.logoPngBase64),
  });
});

const patchSchema = z.object({
  headerText: z.string().max(500),
  footerText: z.string().max(500),
});

export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
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
    receiptFormat: {
      ...currentReceiptFormat,
      headerText: parsed.data.headerText,
      footerText: parsed.data.footerText,
    },
  };

  const { error } = await supabase
    .from('stores')
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
