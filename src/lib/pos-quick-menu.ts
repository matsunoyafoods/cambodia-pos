// TOP画面 (テーブルマップ) のショートカットアイコン (2026-09-04 追加。Tom「メニューから6個だけ
// TOP画面にアイコン表示できるようにしてほしい。アイコンはAIっぽくないのでおまかせします」)。
// ☰ メニュー (pos-app.tsx) にある画面遷移リンクのうち、店舗が選んだ最大6個をテーブルマップ
// 画面の上部にアイコンボタンとして常時表示する。アイコンは lucide-react (シンプルな線画の
// アイコンセット。生成AIっぽい派手さを避けたいという要望に対応) を使う。
//
// pos.stores.settings (jsonb) に quickMenuKeys (この QuickMenuKey の配列、最大6件) として保存する
// (themeColor / backgroundColor と同じ場所)。権限によるアイコンの出し分けは行わない — 元々☰メニュー
// 自体がロールで絞り込まれておらず、各画面側 (canManage 等) で自己防御しているのと同じ考え方。

import {
  BarChart3,
  CalendarDays,
  ChefHat,
  Clock,
  CupSoda,
  LayoutGrid,
  LineChart,
  QrCode,
  Receipt,
  Settings,
  Smartphone,
  Wallet,
  Landmark,
  type LucideIcon,
} from 'lucide-react';

export type QuickMenuKey =
  | 'settings'
  | 'tableLayout'
  | 'reservations'
  | 'handy'
  | 'kitchen'
  | 'drinks'
  | 'qrCodes'
  | 'expenses'
  | 'timecard'
  | 'insights'
  | 'salesReport'
  | 'registerClosing'
  | 'payroll';

export type QuickMenuItem = {
  key: QuickMenuKey;
  path: string;
  icon: LucideIcon;
  labelKey: string;
};

// ☰ メニュー (pos-app.tsx) と同じ画面・同じ表示順。
export const QUICK_MENU_ITEMS: QuickMenuItem[] = [
  { key: 'settings', path: '/pos/settings', icon: Settings, labelKey: 'posApp.menuSettings' },
  { key: 'tableLayout', path: '/pos/table-layout', icon: LayoutGrid, labelKey: 'posApp.menuTableLayout' },
  { key: 'reservations', path: '/pos/reservations', icon: CalendarDays, labelKey: 'posApp.menuReservations' },
  { key: 'handy', path: '/pos/handy', icon: Smartphone, labelKey: 'handyApp.title' },
  { key: 'kitchen', path: '/pos/kitchen', icon: ChefHat, labelKey: 'posApp.menuKitchen' },
  { key: 'drinks', path: '/pos/drinks', icon: CupSoda, labelKey: 'posApp.menuDrinkMonitor' },
  { key: 'qrCodes', path: '/pos/qr-codes', icon: QrCode, labelKey: 'posApp.menuQrCodes' },
  { key: 'expenses', path: '/pos/expenses', icon: Receipt, labelKey: 'posApp.menuExpenses' },
  { key: 'timecard', path: '/pos/timecard', icon: Clock, labelKey: 'posApp.menuTimecard' },
  { key: 'insights', path: '/pos/insights', icon: LineChart, labelKey: 'posApp.menuInsights' },
  { key: 'salesReport', path: '/pos/sales-report', icon: BarChart3, labelKey: 'posApp.menuSalesReport' },
  { key: 'registerClosing', path: '/pos/register-closing', icon: Landmark, labelKey: 'posApp.menuRegisterClosing' },
  { key: 'payroll', path: '/pos/payroll', icon: Wallet, labelKey: 'posApp.menuPayroll' },
];

const QUICK_MENU_ITEM_BY_KEY = new Map(QUICK_MENU_ITEMS.map((i) => [i.key, i]));

export function isQuickMenuKey(value: string): value is QuickMenuKey {
  return QUICK_MENU_ITEM_BY_KEY.has(value as QuickMenuKey);
}

export const MAX_QUICK_MENU_ITEMS = 6;

// 初期値 (未設定の店舗向け)。営業中によく使う画面を優先。
// pos-types.ts の DEFAULT_SETTINGS.quickMenuKeys と同じ値にしておくこと。
export const DEFAULT_QUICK_MENU_KEYS: QuickMenuKey[] = ['kitchen', 'drinks', 'handy', 'reservations', 'timecard', 'tableLayout'];

export function resolveQuickMenuItems(keys: string[]): QuickMenuItem[] {
  return keys
    .filter(isQuickMenuKey)
    .slice(0, MAX_QUICK_MENU_ITEMS)
    .map((k) => QUICK_MENU_ITEM_BY_KEY.get(k))
    .filter((i): i is QuickMenuItem => !!i);
}
