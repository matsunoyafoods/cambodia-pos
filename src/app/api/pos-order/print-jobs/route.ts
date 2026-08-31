import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { formatInvoiceText, formatKitchenTicketText, formatReceiptText } from '@/lib/receipt-format';
import { pngBase64ToEscPosRasterBase64 } from '@/lib/escpos-logo';
import type { ReceiptFormatSettings } from '@/lib/pos-types';

// レジ画面から「印刷したい」内容をキューに積む (2026-08-31 プリンター実装で追加)。
// /api/pos-order/* の他ルートと同じ理由で認証なし (レジ端末自体からの呼び出しのみ想定)。
// 実際の印字はローカル印刷エージェントが /api/print-agent/jobs をポーリングして行う。
// 該当ロールのプリンターが1台も設定・有効化されていなくても、レジ操作(注文確定・会計)自体は
// 止めたくないので、その場合は静かに ok:true (printersQueued: 0) を返す。
//
// 2026-08-31 変更: 以前はクライアント側で整形済みのテキスト (content 1本) を受け取り、
// 該当ロールの全プリンターへそのまま複製していた。これだと店名・ヘッダー/フッター文言・
// 用紙幅がプリンターごとに違っても反映できない (プリンター登録時の paperWidthMm が
// 印字に全く使われていなかった) ため、ここではプリンターごとの生データだけを受け取り、
// 店舗設定 (店名・ヘッダー/フッター文言・ロゴ) とプリンター個別の paperWidthMm を
// サーバー側で当てはめてから整形するように変更した。

const receiptItemSchema = z.object({ name: z.string(), qty: z.number(), lineTotal: z.number() });
const kitchenItemSchema = z.object({ name: z.string(), qty: z.number(), optionsLabel: z.string().optional() });
const paymentSchema = z.object({ method: z.enum(['cash', 'qr', 'card']), amount: z.number() });

const postSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('kitchen'),
    orderId: z.string().uuid().optional(),
    tableCode: z.string().nullable(),
    items: z.array(kitchenItemSchema),
  }),
  z.object({
    kind: z.literal('receipt'),
    orderId: z.string().uuid().optional(),
    tableCode: z.string().nullable(),
    items: z.array(receiptItemSchema),
    subtotal: z.number(),
    vat: z.number(),
    vatRate: z.number(),
    vatInclusive: z.boolean(),
    service: z.number(),
    serviceRate: z.number(),
    couponDiscount: z.number(),
    orderDiscount: z.number(),
    total: z.number(),
    payments: z.array(paymentSchema),
  }),
  z.object({
    kind: z.literal('invoice'),
    orderId: z.string().uuid().optional(),
    recipientName: z.string(),
    description: z.string(),
    total: z.number(),
    invoiceNo: z.string(),
  }),
]);

const ROLE_FOR_KIND = { kitchen: 'kitchen', receipt: 'receipt', invoice: 'receipt' } as const;

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const role = ROLE_FOR_KIND[d.kind];
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const now = new Date();

  const [{ data: printers, error: printersError }, { data: store, error: storeError }] = await Promise.all([
    supabase
      .from('printers')
      .select('id, paper_width_mm')
      .eq('store_id', storeId)
      .eq('role', role)
      .eq('enabled', true),
    supabase.from('stores').select('name, settings').eq('id', storeId).maybeSingle(),
  ]);
  if (printersError) return NextResponse.json({ error: printersError.message }, { status: 500 });
  if (storeError) return NextResponse.json({ error: storeError.message }, { status: 500 });
  if (!printers || printers.length === 0) {
    return NextResponse.json({ ok: true, printersQueued: 0 });
  }

  const storeName = store?.name ?? "I'mHungry";
  const storedSettings = (store?.settings && typeof store.settings === 'object' ? store.settings : {}) as {
    receiptFormat?: Partial<ReceiptFormatSettings>;
  };
  const receiptFormat = storedSettings.receiptFormat ?? {};
  const headerText = receiptFormat.headerText ?? '';
  const footerText = receiptFormat.footerText ?? '';
  const logoPngBase64 = receiptFormat.logoPngBase64 ?? null;

  const rows = printers.map((p) => {
    let content: string;
    if (d.kind === 'kitchen') {
      content = formatKitchenTicketText({
        tableCode: d.tableCode,
        items: d.items,
        paperWidthMm: p.paper_width_mm,
        confirmedAt: now,
      });
    } else if (d.kind === 'receipt') {
      content = formatReceiptText({
        storeName,
        headerText,
        footerText,
        tableCode: d.tableCode,
        items: d.items,
        subtotal: d.subtotal,
        vat: d.vat,
        vatRate: d.vatRate,
        vatInclusive: d.vatInclusive,
        service: d.service,
        serviceRate: d.serviceRate,
        couponDiscount: d.couponDiscount,
        orderDiscount: d.orderDiscount,
        total: d.total,
        payments: d.payments,
        paperWidthMm: p.paper_width_mm,
        paidAt: now,
      });
    } else {
      content = formatInvoiceText({
        storeName,
        headerText,
        footerText,
        recipientName: d.recipientName,
        description: d.description,
        total: d.total,
        invoiceNo: d.invoiceNo,
        paperWidthMm: p.paper_width_mm,
        paidAt: now,
      });
    }

    // ロゴはレシート・領収書のみ (厨房伝票には付けない)。未設定・変換失敗時は静かに無し扱い。
    const logoBase64 =
      d.kind !== 'kitchen' && logoPngBase64 ? pngBase64ToEscPosRasterBase64(logoPngBase64, p.paper_width_mm) : null;

    return {
      store_id: storeId,
      printer_id: p.id,
      order_id: d.orderId ?? null,
      kind: d.kind,
      content,
      logo_base64: logoBase64,
    };
  });

  const { error: insertError } = await supabase.from('print_jobs').insert(rows);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ ok: true, printersQueued: printers.length });
}
