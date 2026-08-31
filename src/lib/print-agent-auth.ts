import 'server-only';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// ローカル印刷エージェント (店舗のPCで動くポーリングスクリプト) は POS スタッフではないので
// Cookie セッションではなく、設定画面で発行する専用トークン (Bearer) で認証する
// (2026-08-31 プリンター実装で追加)。トークンは pos.stores.settings.printAgentToken に保存する
// (他の店舗設定と同じ jsonb を再利用、新規マイグレーション不要)。

export async function verifyAgentToken(req: Request): Promise<{ ok: true } | { ok: false; status: number }> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (!token) return { ok: false, status: 401 };

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error || !data) return { ok: false, status: 500 };

  const stored = (data.settings && typeof data.settings === 'object' ? data.settings : {}) as {
    printAgentToken?: string;
  };
  if (!stored.printAgentToken || stored.printAgentToken !== token) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}
