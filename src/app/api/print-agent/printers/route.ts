import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { verifyAgentToken } from '@/lib/print-agent-auth';

// ローカル印刷エージェントが起動時・定期的に呼ぶ: このトークンに紐づく店舗のプリンター一覧
// (接続方法・LAN先・エージェント側のキュー名) を返す (2026-08-31 プリンター実装で追加)。
export async function GET(req: Request) {
  const auth = await verifyAgentToken(req);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('printers')
    .select('id, name, role, connection_type, paper_width_mm, device_name, lan_ip, lan_port, enabled')
    .eq('store_id', storeId)
    .eq('enabled', true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    printers: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      connectionType: p.connection_type,
      paperWidthMm: p.paper_width_mm,
      deviceName: p.device_name,
      lanIp: p.lan_ip,
      lanPort: p.lan_port,
    })),
  });
}
