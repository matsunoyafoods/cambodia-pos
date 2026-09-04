import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';

// POS ネイティブ (PIN ログイン) スタッフのセッション管理。
// matsunoya-dine の Telegram bot-login とは完全に独立した仕組み
// (Supabase Auth のセッションは発行しない)。
// multi-tenant-productization-spec.md §3.4 の設計方針に対応。

const COOKIE_NAME = 'pos_staff_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12時間 (長めのシフトでも切れないように)

// 2026-09-04: 4段階の権限を追加 (Tom「スタッフタブの中でスタッフ権限をつけられるように
// してください。マネージャー／サブマネージャー／社員／バイトにしてください。マネージャーは
// 全て観覧できます。サブマネージャーはスタッフの給料とAI診断と売上レポートは見ることが
// できません。」)。sub_manager は ROLE_RANK 上は manager と同格 (linear rank では表現できない
// 「manager 相当だが特定3領域だけ見れない」という制約は withPosStaff の deny リストで別途表現する)。
// employee / part_time は旧 'staff' を分割したもの (今回の要望では挙動差の指定は無し、
// 将来の細分化に備えて別値にしておく)。
export type PosStaffRole = 'owner' | 'manager' | 'sub_manager' | 'employee' | 'part_time';

export type PosStaffSessionPayload = {
  staffId: string;
  storeId: string;
  displayName: string;
  role: PosStaffRole;
};

function getSecretKey(): Uint8Array {
  const secret = process.env.POS_STAFF_SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing POS_STAFF_SESSION_SECRET');
  }
  return new TextEncoder().encode(secret);
}

// ---------- PIN ハッシュ ----------

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

// ---------- セッション JWT ----------

export async function issueStaffSessionToken(payload: PosStaffSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

function isPosStaffRole(value: unknown): value is PosStaffRole {
  return value === 'owner' || value === 'manager' || value === 'sub_manager' || value === 'employee' || value === 'part_time';
}

export async function verifyStaffSessionToken(token: string): Promise<PosStaffSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.staffId === 'string' &&
      typeof payload.storeId === 'string' &&
      typeof payload.displayName === 'string' &&
      isPosStaffRole(payload.role)
    ) {
      return {
        staffId: payload.staffId,
        storeId: payload.storeId,
        displayName: payload.displayName,
        role: payload.role,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setStaffSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax', // POS API は同一オリジンからのみ呼ぶ想定 (cross-origin dine連携とは別物)
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearStaffSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getStaffSessionFromCookies(): Promise<PosStaffSessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyStaffSessionToken(token);
}

// ---------- Route Handler 用ガード ----------

const ROLE_RANK: Record<PosStaffRole, number> = {
  part_time: 0,
  employee: 0,
  sub_manager: 1,
  manager: 1,
  owner: 2,
};

/**
 * matsunoya-dine の withAdmin/requireAdmin と同じ役割の POS ネイティブ版。
 * Cookie のセッションを検証し、role が minRole 未満なら 403 を返す。
 *
 * opts.deny: sub_manager のように「rank は manager と同格だが特定の画面/API は見せない」
 * ロールを個別に締め出すための追加チェック (2026-09-04 追加)。rank チェックを通過した後、
 * session.role が deny リストに含まれていれば 403。
 */
export function withPosStaff<Args extends unknown[]>(
  minRole: PosStaffRole,
  handler: (session: PosStaffSessionPayload, req: Request, ...args: Args) => Promise<Response>,
  opts?: { deny?: PosStaffRole[] },
) {
  return async function (req: Request, ...args: Args): Promise<Response> {
    const session = await getStaffSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (ROLE_RANK[session.role] < ROLE_RANK[minRole]) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (opts?.deny?.includes(session.role)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return handler(session, req, ...args);
  };
}
