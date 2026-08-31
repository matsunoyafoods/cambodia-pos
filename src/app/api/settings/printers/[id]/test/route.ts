import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { columnsForPaperWidth } from '@/lib/receipt-format';

type RouteContext = { params: Promise<{ id: string }> };

// 設定画面の「テスト印刷」ボタン。指定したプリンター宛にテスト伝票を1件キューに積む。
// 実際の印字はローカル印刷エージェントが /api/print-agent/jobs をポーリングして行う
// (2026-08-31 プリンター実装で追加)。
export const POST = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: printer, error: printerError } = await supabase
    .from('printers')
    .select('id, name, paper_width_mm')
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
