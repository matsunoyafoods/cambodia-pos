import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 銀行入金の記録 (2026-09-02 追加)。
// Tom「レジの中に現金売上が貯まります。現金売上を銀行入金します。」への対応。
// レジの現金を銀行に入金した記録。現金残高 (/api/cash-balance) からはこの合計が差し引かれる。
// 経費 (支出) ではなく「現金の置き場所が変わるだけ」の記録のため、経費テーブルとは別に持つ。

type Row = {
  id: string;
  date: string;
  amount_usd: number;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
};

function toApi(row: Row) {
  return {
    id: row.id,
    date: row.date,
    amountUsd: row.amount_usd,
    note: row.note,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

const selectCols = 'id, date, amount_usd, note, created_by_name, created_at';

// 一覧 (期間絞り込み可)。manager 以上のみ (経費レポートと同じ、店舗の資金状況が見える情報のため)。
export const GET = withPosStaff('manager', async (_session, req) => {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  let query = supabase.from('cash_deposits').select(selectCols).eq('store_id', storeId).order('date', { ascending: false }).order('created_at', { ascending: false });
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deposits: (data ?? []).map(toApi) });
});

const postSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で入力してください'),
  amountUsd: z.number().positive(),
  note: z.string().trim().max(500).optional(),
});

// 新規登録。staff 以上 (銀行に入金しに行った本人がその場で記録できるように、経費記録と同じ方針)。
export const POST = withPosStaff('part_time', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('cash_deposits')
    .insert({
      store_id: storeId,
      date: d.date,
      amount_usd: d.amountUsd,
      note: d.note || null,
      created_by_name: session.displayName,
    })
    .select(selectCols)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deposit: toApi(data) }, { status: 201 });
});
