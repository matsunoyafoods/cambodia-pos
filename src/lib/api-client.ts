/**
 * matsunoya-dine 側の /api/pos/* を呼び出す共通クライアント。
 *
 * 認証は matsunoya-dine の sb-access-token Cookie (SameSite=None; Secure) を
 * そのまま使う。credentials:'include' を付けることで、スタッフが同じブラウザで
 * matsunoya-dine にログイン済みなら別オリジンの cambodia-pos からでも
 * 自動的に Cookie が送られる。
 *
 * matsunoya-dine 側は POS_ALLOWED_ORIGINS に登録された Origin だけを CORS で許可する。
 */

const API_BASE = process.env.NEXT_PUBLIC_MATSUNOYA_DINE_API_URL ?? 'https://app.matsunoyafoods.com';

export class PosApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
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
    throw new PosApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type StaffSession = {
  staff: {
    id: string;
    display_name: string;
    role: 'owner' | 'manager' | 'staff';
    store_id: string;
    store_name: string;
  };
};

export function getPosSession(): Promise<StaffSession> {
  return request<StaffSession>('/api/pos/session');
}

export type PosOptionChoice = { id: string; label: string; priceDelta: number };
export type PosOptionGroup = {
  key: string;
  label: string;
  required: boolean;
  choices: PosOptionChoice[];
};
export type PosMenuItem = {
  id: string;
  category: string | null;
  name: string;
  price: number;
  optionGroups?: PosOptionGroup[];
};

export function getPosMenus(): Promise<PosMenuItem[]> {
  return request<PosMenuItem[]>('/api/pos/menus');
}

export type PosSettings = {
  vatRate: number;
  serviceRate: number;
  khrRate: number;
  cashEnabled: boolean;
  qrEnabled: boolean;
  cardEnabled: boolean;
};

export function getPosSettings(): Promise<PosSettings> {
  return request<PosSettings>('/api/pos/settings');
}

export function updatePosSettings(input: PosSettings): Promise<PosSettings> {
  return request<PosSettings>('/api/pos/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** ログインチェック専用: 401 なら false を返す（例外を投げない） */
export async function checkStaffSession(): Promise<StaffSession['staff'] | null> {
  try {
    const { staff } = await getPosSession();
    return staff;
  } catch (error) {
    if (error instanceof PosApiError && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
}
