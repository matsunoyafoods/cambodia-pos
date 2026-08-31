import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { verifyAgentToken } from '@/lib/print-agent-auth';

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(['printed', 'failed']),
  errorMessage: z.string().max(500).optional(),
});

// ローカル印刷エージェントが印字後に結果を報告する (2026-08-31 プリンター実装で追加)。
export async function PATCH(req: Request, ctx: RouteContext) {
  const auth = await verifyAgentToken(req);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });

  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { error } = await supabase
    .from('print_jobs')
    .update({
      status: d.status,
      error_message: d.errorMessage ?? null,
      printed_at: d.status === 'printed' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('store_id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
