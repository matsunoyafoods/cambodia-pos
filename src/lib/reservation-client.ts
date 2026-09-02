/**
 * 予約受付機能の API クライアント (設定画面などと同じ、同一オリジン・cookie 認証)。
 */

export class ReservationApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ReservationApiError';
  }
}

export type ReservationType = 'normal' | 'tenderloin_block' | 'birthday_room' | 'group';
export type ReservationStatus = 'confirmed' | 'cancelled';

export type ReservationRecord = {
  id: string;
  reservationType: ReservationType;
  customerName: string;
  phone: string | null;
  partySize: number | null;
  reservationDate: string; // 'YYYY-MM-DD'
  reservationTime: string | null; // 'HH:MM'
  details: Record<string, string>;
  notes: string | null;
  status: ReservationStatus;
  createdByName: string | null;
  createdAt: string;
  /** 'pos' = POSで直接受け付けた電話予約。'app' = matsunoya-dineアプリ予約 (読み取り専用でマージ表示、2026-08-31 追加) */
  source: 'pos' | 'app';
  /** 割り当てられた卓コード (2026-09-02 追加)。未割当は [] */
  tableCodes: string[];
};

export type CreateReservationInput = {
  reservationType: ReservationType;
  customerName: string;
  phone?: string;
  partySize?: number;
  reservationDate: string;
  reservationTime?: string;
  details?: Record<string, string>;
  notes?: string;
};

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
    throw new ReservationApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export function getReservations(): Promise<{ items: ReservationRecord[] }> {
  return request('/api/reservations');
}

export function createReservation(input: CreateReservationInput): Promise<ReservationRecord> {
  return request('/api/reservations', { method: 'POST', body: JSON.stringify(input) });
}

export function cancelReservation(id: string): Promise<ReservationRecord> {
  return request(`/api/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
}

// 予約の卓割り当て (2026-09-02 追加)。POS電話予約・アプリ予約どちらの id でも呼べる。
export function assignReservationTables(id: string, tableCodes: string[]): Promise<{ id: string; tableCodes: string[] }> {
  return request(`/api/reservations/${encodeURIComponent(id)}/tables`, {
    method: 'PATCH',
    body: JSON.stringify({ tableCodes }),
  });
}
