import 'server-only';
import { ETHNICITY_KEYS, ETHNICITY_LABELS, type EthnicityKey, type TimePeriod } from '@/lib/pos-types';

// 客数・組数・人種内訳・時間帯別売上の共通集計ロジック (2026-10-01 追加)。Tom「客数、組数、
// 人種人数、ランチタイム売上、ディナータイム売上をレポートに追記してほしい」への対応。
// 以下の3箇所で同じ集計ロジックを使う (重複実装による計算ズレを防ぐため、必ずここを経由する):
//   - /api/sales-report/today (レジ画面ヘッダーの本日集計)
//   - /api/sales-report/daily (月間日別レポート画面)
//   - register-closings/route.ts → sales-report-notify.ts (レジ締め時のTelegram通知)
// 人数 (客数) の定義は既存の sales-report/tables/route.ts と同じ: 人種内訳の合計 + 子供人数。
// 組数 = 対象期間内の会計 (pos.orders, status='paid') 件数そのもの。

export type GuestStatsOrderInput = {
  guest_ethnicity: Partial<Record<EthnicityKey, number>> | null;
  guest_kids_count: number | null;
};

export type EthnicityTotal = { key: EthnicityKey; label: string; count: number };

export type GuestStats = {
  /** 客数 = 人種内訳の合計 + 子供人数 (未記録の会計は0人として扱う) */
  guestCount: number;
  /** 組数 = 対象期間の会計件数 */
  partyCount: number;
  /** 人種内訳 (0件の区分は除外。tables/route.ts と同じ表示方針) */
  ethnicityTotals: EthnicityTotal[];
};

export function computeGuestStats(orders: GuestStatsOrderInput[]): GuestStats {
  const totals = Object.fromEntries(ETHNICITY_KEYS.map((key) => [key, 0])) as Record<EthnicityKey, number>;
  let guestCount = 0;
  for (const order of orders) {
    const ethnicity = order.guest_ethnicity ?? {};
    for (const key of ETHNICITY_KEYS) {
      const count = ethnicity[key] ?? 0;
      totals[key] += count;
      guestCount += count;
    }
    guestCount += order.guest_kids_count ?? 0;
  }
  return {
    guestCount,
    partyCount: orders.length,
    ethnicityTotals: ETHNICITY_KEYS.filter((key) => totals[key] > 0).map((key) => ({ key, label: ETHNICITY_LABELS[key], count: totals[key] })),
  };
}

export type TimePeriodSalesOrderInput = { total: number; paid_at: string };

export type TimePeriodSalesResult = {
  id: string;
  label: string;
  start: string;
  end: string;
  total: number;
  orderCount: number;
};

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

// paid_at (UTC ISO) をカンボジア時間の 'HH:MM' に変換する。カンボジアはDST無しの固定 UTC+7
// (register-closings/route.ts の dayRangeUtc と同じ考え方)。
function localHm(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

// start <= end の通常区間 (例: 11:00〜15:00) だけでなく、end < start の日またぎ区間
// (例: 22:00〜02:00、深夜営業向け) にも対応する。
function inTimeRange(hm: string, start: string, end: string): boolean {
  if (start <= end) return hm >= start && hm < end;
  return hm >= start || hm < end;
}

// 設定された時間帯 (TimePeriod[]) ごとに、その区間内に決済された会計の売上・件数を集計する。
// 区間が重複していても (例: 設定ミスで時間帯が被っていても) 単純にそれぞれ独立して集計するだけ
// (重複排除や警告は行わない。設定側の責任)。
export function computeTimePeriodSales(orders: TimePeriodSalesOrderInput[], periods: TimePeriod[]): TimePeriodSalesResult[] {
  return periods.map((period) => {
    let total = 0;
    let orderCount = 0;
    for (const order of orders) {
      if (!inTimeRange(localHm(order.paid_at), period.start, period.end)) continue;
      total += Number(order.total);
      orderCount += 1;
    }
    return { id: period.id, label: period.label, start: period.start, end: period.end, total, orderCount };
  });
}
