import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { notifyFeedbackReport } from '@/lib/telegram-notify';

// スタッフからのフィードバック報告 (誤字・不具合、2026-10-07 追加)。Tom「スタッフが誤字を
// 見つけたらドックフーティングでAIに送信して修繕する」への対応。
//
// 全スタッフ (part_time含む) が送信可能 — 誤字はどのスタッフでも気づけるため。
// pos.feedback_reports に保存しつつ、Telegramへ即時通知する (アプリ内の一覧画面は
// 今回作らない。Tomがテレグラム通知だけで十分と判断したため)。通知が失敗しても
// 報告自体は成功させる (fire-and-forget、他の通知と同じ方針)。
const postSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  pagePath: z.string().trim().max(200).optional(),
});

export const POST = withPosStaff('part_time', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { message, pagePath } = parsed.data;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle();

  const { error } = await supabase.from('feedback_reports').insert({
    store_id: storeId,
    staff_id: session.staffId,
    staff_name: session.displayName,
    message,
    page_path: pagePath ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  notifyFeedbackReport({
    message,
    pagePath: pagePath ?? null,
    staffName: session.displayName,
    storeName: store?.name,
  }).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 201 });
});
