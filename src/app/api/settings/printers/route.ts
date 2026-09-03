import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PrinterConfig } from '@/lib/pos-types';

// プリンター設定 (2026-08-31 プリンター実装で追加)。POS ネイティブ運用店舗向け。
// pos.printers を CRUD する。実際の印刷は店舗側のローカル印刷エージェントが行う
// (/api/print-agent/* を参照)。

type PrinterRow = {
  id: string;
  name: string;
  role: string;
  connection_type: string;
  paper_width_mm: number;
  device_name: string | null;
  lan_ip: string | null;
  lan_port: number | null;
  enabled: boolean;
};

function toPrinterConfig(row: PrinterRow): PrinterConfig {
  return {
    id: row.id,
    name: row.name,
    role: row.role as PrinterConfig['role'],
    connectionType: row.connection_type as PrinterConfig['connectionType'],
    paperWidthMm: row.paper_width_mm,
    deviceName: row.device_name,
    lanIp: row.lan_ip,
    lanPort: row.lan_port,
    enabled: row.enabled,
  };
}

export const GET = withPosStaff('staff', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('printers')
    .select('id, name, role, connection_type, paper_width_mm, device_name, lan_ip, lan_port, enabled')
    .eq('store_id', storeId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ printers: (data as PrinterRow[]).map(toPrinterConfig) });
});

const createSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.enum(['receipt', 'kitchen']),
  connectionType: z.enum(['usb_agent', 'lan', 'bluetooth', 'passprnt']),
  paperWidthMm: z.number().int().positive().default(58),
  deviceName: z.string().max(120).optional(),
  lanIp: z.string().max(64).optional(),
  lanPort: z.number().int().positive().max(65535).optional(),
  enabled: z.boolean().default(true),
});

export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('printers')
    .insert({
      store_id: storeId,
      name: d.name,
      role: d.role,
      connection_type: d.connectionType,
      paper_width_mm: d.paperWidthMm,
      device_name: d.deviceName ?? null,
      lan_ip: d.lanIp ?? null,
      lan_port: d.lanPort ?? 9100,
      enabled: d.enabled,
    })
    .select('id, name, role, connection_type, paper_width_mm, device_name, lan_ip, lan_port, enabled')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ printer: toPrinterConfig(data as PrinterRow) });
});
