import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// レジ画面向け、卓の「滞在タイマー・飲み放題タイマー」用の公開エンドポイント (認証なし。
// 理由は同ディレクトリの mode/menu/settings/table-layout と同じ: dine 連携ログインの
// Cookie は別オリジンのためこのサーバーから見えず、withPosStaff を使うとレジ画面自体が
// 読めなくなってしまう)。
//
// pos.table_sessions は「卓の現在の来店セッション」を1行だけ持つ。会計完了・スタッフに
// よるリセットで行を削除し、次の来店に備える。滞在時間・残り飲み放題時間そのものは
// クライアント側で started_at からの経過時間として計算する (このAPIはタイムスタンプの
// 起点だけを返す/更新する)。

type Action = 'start_stay' | 'start_drink' | 'extend_drink' | 'clear';

const postSchema = z.object({
  tableCode: z.string().min(1),
  action: z.enum(['start_stay', 'start_drink', 'extend_drink', 'clear']),
  drinkMinutes: z.number().int().positive().max(600).optional(), // start_drink/extend_drink で使う分数 (省略時 60/30)
});

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('table_sessions')
    .select('table_code, started_at, drink_timer_started_at, drink_timer_minutes')
    .eq('store_id', storeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { tableCode, action, drinkMinutes } = parsed.data as { tableCode: string; action: Action; drinkMinutes?: number };

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const nowIso = new Date().toISOString();

  if (action === 'clear') {
    const { error } = await supabase.from('table_sessions').delete().eq('store_id', storeId).eq('table_code', tableCode);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'start_stay') {
    // 既にセッションがあれば起点時刻は変えない (同じ卓への2品目以降の注文で滞在タイマーが
    // リセットされないように)。無ければ新規作成。
    const { data: existing, error: readError } = await supabase
      .from('table_sessions')
      .select('id')
      .eq('store_id', storeId)
      .eq('table_code', tableCode)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
    if (!existing) {
      const { error } = await supabase
        .from('table_sessions')
        .insert({ store_id: storeId, table_code: tableCode, started_at: nowIso, updated_at: nowIso });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'start_drink') {
    const minutes = drinkMinutes ?? 60;
    // 滞在タイマーがまだ無い卓で飲み放題だけ先に注文された場合にも対応できるよう upsert する。
    const { data: existing, error: readError } = await supabase
      .from('table_sessions')
      .select('id, drink_timer_started_at')
      .eq('store_id', storeId)
      .eq('table_code', tableCode)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

    if (!existing) {
      const { error } = await supabase.from('table_sessions').insert({
        store_id: storeId,
        table_code: tableCode,
        started_at: nowIso,
        drink_timer_started_at: nowIso,
        drink_timer_minutes: minutes,
        updated_at: nowIso,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (!existing.drink_timer_started_at) {
      // 既に飲み放題タイマーが動いている場合は起点を上書きしない (二重注文で延長扱いにならない
      // ように。延長したい場合は action: 'extend_drink' を使う)。
      const { error } = await supabase
        .from('table_sessions')
        .update({ drink_timer_started_at: nowIso, drink_timer_minutes: minutes, updated_at: nowIso })
        .eq('id', existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // extend_drink
  const extendBy = drinkMinutes ?? 30;
  const { data: existing, error: readError } = await supabase
    .from('table_sessions')
    .select('id, drink_timer_minutes, drink_timer_started_at')
    .eq('store_id', storeId)
    .eq('table_code', tableCode)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  if (!existing) {
    // 飲み放題タイマー未開始のまま延長だけ押された場合は、延長分の時間で新規開始する。
    const { error } = await supabase.from('table_sessions').insert({
      store_id: storeId,
      table_code: tableCode,
      started_at: nowIso,
      drink_timer_started_at: nowIso,
      drink_timer_minutes: extendBy,
      updated_at: nowIso,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const currentMinutes = existing.drink_timer_minutes ?? 0;
  const { error } = await supabase
    .from('table_sessions')
    .update({
      drink_timer_started_at: existing.drink_timer_started_at ?? nowIso,
      drink_timer_minutes: currentMinutes + extendBy,
      updated_at: nowIso,
    })
    .eq('id', existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
