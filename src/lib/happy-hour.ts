import type { MenuItem, PosSettings } from '@/lib/pos-types';

// 店舗のタイムゾーンは常に Asia/Phnom_Penh (1デプロイ=1店舗の前提。supabase/migrations/0002 の
// pos.stores.timezone デフォルト値と同じ)。ブラウザ(レジ端末)側のタイムゾーン設定に依存せず
// 正しく判定できるよう、Intl API で明示的にこのタイムゾーンの時刻を取り出す。
const STORE_TIMEZONE = 'Asia/Phnom_Penh';

function nowHHMMInStoreTimezone(now: Date): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: STORE_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(now); // 'HH:MM'
}

export function isHappyHourNow(settings: Pick<PosSettings, 'happyHourEnabled' | 'happyHourStart' | 'happyHourEnd'>, now: Date = new Date()): boolean {
  if (!settings.happyHourEnabled) return false;
  const current = nowHHMMInStoreTimezone(now);
  const { happyHourStart, happyHourEnd } = settings;
  if (!happyHourStart || !happyHourEnd) return false;
  // 通常営業時間内 (日をまたがない) の単純な範囲判定。'17:00' <= current < '19:00'。
  return current >= happyHourStart && current < happyHourEnd;
}

// ハッピーアワー中に商品の基準価格として使う値。happyHourPrice が設定されていない
// 商品は対象外なので通常価格のまま。オプション (量目・グラス/ボトル等) の price_delta は
// この上に加算されるので、グラス/ボトルのようなサイズ違いは自動的に整合する。
export function effectiveBasePrice(item: MenuItem, happyHourActive: boolean): number {
  if (happyHourActive && typeof item.happyHourPrice === 'number') {
    return item.happyHourPrice;
  }
  return item.price;
}
