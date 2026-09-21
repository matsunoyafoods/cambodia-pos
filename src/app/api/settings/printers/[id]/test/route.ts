import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { columnsForPaperWidth, sizeDotsForPaperWidth, wrapAsPassPrntHtml } from '@/lib/receipt-format';
import { buildEscPosFrame } from '@/lib/escpos-frame';
import { parseWebUsbDeviceName } from '@/lib/webusb-printer';

type RouteContext = { params: Promise<{ id: string }> };

// 設定画面の「テスト印刷」ボタン。
// - usb_agent/lan/bluetooth (中継PC方式): テスト伝票を1件キューに積む。実際の印字は
//   ローカル印刷エージェントが /api/print-agent/jobs をポーリングして行う (2026-08-31 追加)。
// - passprnt (レジ端末に直接ペアリングする方式、2026-09-03 追加): キューには積まず、
//   PassPRNT用のHTMLをそのままレスポンスで返す。呼び出し元 (設定画面) がその場で
//   starpassprnt:// URLスキームを開いて印刷する (この端末自体がプリンターとペアリング
//   されている前提)。
// - webusb (2026-09-21 追加。USB接続のプリンターにレジ端末 (Android Chrome) から直接印刷する
//   方式): キューには積まず、ESC/POSの生バイト列 (base64) をそのまま返す。呼び出し元がWebUSBで
//   ペアリング済みのプリンターへ直接書き込む。
export const POST = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: printer, error: printerError } = await supabase
    .from('printers')
    .select('id, name, paper_width_mm, connection_type, device_name')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (printerError) return NextResponse.json({ error: printerError.message }, { status: 500 });
  if (!printer) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const w = columnsForPaperWidth(printer.paper_width_mm);
  const content = [
    '='.repeat(w),
    'テスト印刷'.padStart(Math.floor((w + 'テスト印刷'.length) / 2)),
    '='.repeat(w),
    `プリンター: ${printer.name}`,
    new Date().toLocaleString('ja-JP'),
    'この行が正しく印刷されれば設定は正常です。',
    '',
    '',
  ].join('\n');

  if (printer.connection_type === 'passprnt') {
    const html = wrapAsPassPrntHtml(content, { paperWidthMm: printer.paper_width_mm });
    return NextResponse.json({
      ok: true,
      passPrntJob: { printerId: printer.id, html, sizeDots: sizeDotsForPaperWidth(printer.paper_width_mm), cut: 'full' },
    });
  }

  if (printer.connection_type === 'webusb') {
    const parsed = parseWebUsbDeviceName(printer.device_name);
    if (!parsed) {
      return NextResponse.json(
        { error: 'このプリンターはまだUSBペアリングされていません。プリンター設定で「USBペアリング」を行ってください。' },
        { status: 400 },
      );
    }
    const dataBase64 = buildEscPosFrame(content).toString('base64');
    return NextResponse.json({
      ok: true,
      webusbJob: { printerId: printer.id, vendorId: parsed.vendorId, productId: parsed.productId, dataBase64 },
    });
  }

  const { error: insertError } = await supabase.from('print_jobs').insert({
    store_id: storeId,
    printer_id: printer.id,
    order_id: null,
    kind: 'test',
    content,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
