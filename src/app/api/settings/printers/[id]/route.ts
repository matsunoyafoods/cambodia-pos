import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PrinterConfig } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

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

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  role: z.enum(['receipt', 'kitchen']).optional(),
  connectionType: z.enum(['usb_agent', 'lan', 'bluetooth', 'passprnt']).optional(),
  paperWidthMm: z.number().int().positive().optional(),
  deviceName: z.string().max(120).nullable().optional(),
  lanIp: z.string().max(64).nullable().optional(),
  lanPort: z.number().int().positive().max(65535).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.name !== undefined) patch.name = d.name;
  if (d.role !== undefined) patch.role = d.role;
  if (d.connectionType !== undefined) patch.connection_type = d.connectionType;
  if (d.paperWidthMm !== undefined) patch.paper_width_mm = d.paperWidthMm;
  if (d.deviceName !== undefined) patch.device_name = d.deviceName;
  if (d.lanIp !== undefined) patch.lan_ip = d.lanIp;
  if (d.lanPort !== undefined) patch.lan_port = d.lanPort;
  if (d.enabled !== undefined) patch.enabled = d.enabled;

  const { data, error } = await supabase
    .from('printers')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, name, role, connection_type, paper_width_mm, device_name, lan_ip, lan_port, enabled')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ printer: toPrinterConfig(data as PrinterRow) });
});

export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { error } = await supabase.from('printers').delete().eq('id', id).eq('store_id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
