/**
 * POS ネイティブ (PIN ログイン) の同一オリジン API クライアント。
 *
 * matsunoya-dine 連携用の api-client.ts (別オリジン、credentials:'include' で
 * Telegram bot-login の Cookie を使う) とは完全に別の認証経路。
 * こちらは cambodia-pos 自身が発行する pos_staff_session Cookie (httpOnly) を使い、
 * 同一オリジンなので fetch にオプション追加は不要。
 */

export class PosStaffApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosStaffApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new PosStaffApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type PosStaffRole = 'owner' | 'manager' | 'staff';

export type PosStaffRosterEntry = { id: string; display_name: string };

export type PosStaffMember = {
  id: string;
  display_name: string;
  role: PosStaffRole;
  active?: boolean;
  created_at?: string;
};

export type PosStaffSessionResponse = {
  staff: { id: string; display_name: string; role: PosStaffRole; store_id: string };
};

export function getStaffRoster(): Promise<{ staff: PosStaffRosterEntry[] }> {
  return request('/api/staff/roster');
}

export function loginWithPin(staffId: string, pin: string): Promise<PosStaffSessionResponse> {
  return request('/api/staff/login', {
    method: 'POST',
    body: JSON.stringify({ staffId, pin }),
  });
}

export function logoutPosStaff(): Promise<{ ok: boolean }> {
  return request('/api/staff/logout', { method: 'POST' });
}

/** ログインチェック専用: 401/403 なら null を返す (例外を投げない) */
export async function checkPosStaffSession(): Promise<PosStaffSessionResponse['staff'] | null> {
  try {
    const { staff } = await request<PosStaffSessionResponse>('/api/staff/session');
    return staff;
  } catch (error) {
    if (error instanceof PosStaffApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
}

export function listStaff(): Promise<{ staff: PosStaffMember[] }> {
  return request('/api/staff');
}

export function createStaff(input: { displayName: string; role: PosStaffRole; pin: string }): Promise<{
  staff: PosStaffMember;
}> {
  return request('/api/staff', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function resetStaffPin(staffId: string, pin: string): Promise<{ staff: PosStaffMember }> {
  return request(`/api/staff/${staffId}/reset-pin`, {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}
