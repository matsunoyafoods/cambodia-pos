import { createBrowserClient } from '@supabase/ssr';

// matsunoya-dine と同じ Supabase プロジェクトを共有し、POS 専用データは
// `pos` スキーマに置く方針 (integration-spec.md 3章)。
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY は
// matsunoya-dine の値をそのまま流用する想定。
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: 'pos' } },
  );
}
