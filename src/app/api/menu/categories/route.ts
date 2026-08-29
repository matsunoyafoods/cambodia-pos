import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// カテゴリ一覧。manager 以上のみ (設定画面のメニュー管理タブ用)。
export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('menu_categories')
    .select('id, name, sort_order')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ categories: data ?? [] });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

// 新規カテゴリ作成。並び順は末尾に自動追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: existing, error: maxError } = await supabase
    .from('menu_categories')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_categories')
    .insert({ store_id: storeId, name: parsed.data.name, sort_order: nextSortOrder })
    .select('id, name, sort_order')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前のカテゴリが既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ category: data }, { status: 201 });
});
