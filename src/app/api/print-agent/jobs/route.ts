import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { verifyAgentToken } from '@/lib/print-agent-auth';

// ローカル印刷エージェントが数秒おきにポーリングする: 未印刷のジョブを返す
// (2026-08-31 プリンター実装で追加)。印字完了・失敗は PATCH /api/print-agent/jobs/[id] で報告する。
export async function GET(req: Request) {
  const auth = await verifyAgentToken(req);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('print_jobs')
    .select('id, printer_id, order_id, kind, content, logo_base64, created_at')
    .eq('store_id', storeId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    jobs: (data ?? []).map((j) => ({
      id: j.id,
      printerId: j.printer_id,
      orderId: j.order_id,
      kind: j.kind,
      content: j.content,
      // ロゴのESC/POSラスターコマンド (base64、Buffer)。未設定ならnull (2026-08-31 追加)
      logoBase64: j.logo_base64,
      createdAt: j.created_at,
    })),
  });
}
