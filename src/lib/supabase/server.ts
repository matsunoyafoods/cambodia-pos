import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// サーバー側 (Server Components / Route Handlers) 用。
// POS のスタッフ認証は matsunoya-dine の staff テーブルを流用する方針
// (integration-spec.md 5章)。実装時に auth ヘルパーをここに追加する。
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'pos' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Component から呼ばれた場合は無視 (middleware 側で更新される)
          }
        },
      },
    },
  );
}
