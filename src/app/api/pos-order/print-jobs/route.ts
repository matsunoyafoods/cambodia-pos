import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// レジ画面から「印刷したい」内容をキューに積む (2026-08-31 プリンター実装で追加)。
// /api/pos-order/* の他ルートと同じ理由で認証なし (レジ端末自体からの呼び出しのみ想定)。
// 実際の印字はローカル印刷エージェントが /api/print-agent/jobs をポーリングして行う。
// 該当ロールのプリンターが1台も設定・有効化されていなくても、レジ操作(注文確定・会計)自体は
// 止めたくないので、その場合は静かに ok:true (printersQueued: 0) を返す。

const postSchema = z.object({
  role: z.enum(['receipt', 'kitchen']),
  kind: z.enum(['receipt', 'kitchen']),
  content: z.string().min(1),
  orderId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: printers, error: printersError } = await supabase
    .from('printers')
    .select('id')
    .eq('store_id', storeId)
    .eq('role', d.role)
    .eq('enabled', true);
  if (printersError) return NextResponse.json({ error: printersError.message }, { status: 500 });
  if (!printers || printers.length === 0) {
    return NextResponse.json({ ok: true, printersQueued: 0 });
  }

  const { error: insertError } = await supabase.from('print_jobs').insert(
    printers.map((p) => ({
      store_id: storeId,
      printer_id: p.id,
      order_id: d.orderId ?? null,
      kind: d.kind,
      content: d.content,
    })),
  );
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ ok: true, printersQueued: printers.length });
}
