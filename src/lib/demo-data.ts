import type { MenuItem, TableInfo } from './pos-types';

// 本番では GET /api/pos/menus (matsunoya-dine 側 API) から取得する。
// 実装初期はこのデモデータで画面を動かし、Supabase 接続後に差し替える。
export const DEMO_MENU: MenuItem[] = [
  {
    id: 'm1',
    category: 'メイン', minorCategory: 'メイン',
    name: 'OG Beef Misuji',
    price: 18,
    optionGroups: [
      {
        key: 'weight',
        label: '量目を選択',
        required: true,
        choices: [
          { id: '100g', label: '100g', priceDelta: 0 },
          { id: '200g', label: '200g', priceDelta: 16 },
          { id: '300g', label: '300g', priceDelta: 30 },
        ],
      },
    ],
  },
  {
    id: 'm2',
    category: 'メイン', minorCategory: 'メイン',
    name: 'US Prime Tenderloin',
    price: 24,
    optionGroups: [
      {
        key: 'weight',
        label: '量目を選択',
        required: true,
        choices: [
          { id: '100g', label: '100g', priceDelta: 0 },
          { id: '200g', label: '200g', priceDelta: 20 },
          { id: '300g', label: '300g', priceDelta: 38 },
        ],
      },
    ],
  },
  { id: 'm3', category: 'メイン', minorCategory: 'メイン', name: '厚切り牛タン', price: 14 },
  { id: 'm4', category: 'メイン', minorCategory: 'メイン', name: 'サムギョプサル', price: 10 },
  {
    id: 'm5',
    category: 'メイン', minorCategory: 'メイン',
    name: 'ステーキセット',
    price: 22,
    optionGroups: [
      {
        key: 'side',
        label: '主食を選択',
        required: true,
        choices: [
          { id: 'bread', label: 'パン', priceDelta: 0 },
          { id: 'rice', label: 'ライス', priceDelta: 0 },
        ],
      },
    ],
  },
  { id: 's1', category: 'サイド', minorCategory: 'サイド', name: 'ライス', price: 2 },
  { id: 's2', category: 'サイド', minorCategory: 'サイド', name: '生野菜サラダ', price: 4 },
  { id: 's3', category: 'サイド', minorCategory: 'サイド', name: 'キムチ盛り合わせ', price: 3 },
  { id: 'd1', category: 'ドリンク', minorCategory: 'ドリンク', name: 'ソフトドリンク', price: 2 },
  { id: 'd2', category: 'ドリンク', minorCategory: 'ドリンク', name: 'カンボジアビール', price: 3 },
  { id: 'd3', category: 'ドリンク', minorCategory: 'ドリンク', name: 'ハウスワイン(グラス)', price: 5 },
];

export const CATEGORIES = ['メイン', 'サイド', 'ドリンク'];

// labelKey: 多言語化 (2026-09-04追加)。label はレイアウト未設定店舗向けのフォールバック表示名
// (日本語) で、React key としても使う。表示時は labelKey を useLanguage() の t() に渡して
// 選択言語の文言に置き換える (呼び出し側: table-map-screen.tsx / handy-table-list.tsx)。
const GROUPS: { label: string; labelKey: string; codes: string[]; seats: number }[] = [
  { label: 'Takeaway', labelKey: 'demoTableGroup.takeaway', codes: ['Takeaway'], seats: 10 },
  { label: 'フロア', labelKey: 'demoTableGroup.floor', codes: ['1', '2', '3', '4', '5'], seats: 4 },
  { label: 'テラス', labelKey: 'demoTableGroup.terrace', codes: ['V1', 'V2', 'V3'], seats: 4 },
  { label: '個室', labelKey: 'demoTableGroup.privateRoom', codes: ['BC1', 'BC2', 'BC3', 'BC4', 'BC5', 'BC6'], seats: 4 },
  { label: 'カウンター', labelKey: 'demoTableGroup.counter', codes: ['C1', 'C2', 'C3', 'C4', 'C5'], seats: 2 },
];

export const DEMO_TABLE_GROUPS = GROUPS;

export const DEMO_TABLES: TableInfo[] = GROUPS.flatMap((g) =>
  g.codes.map((code) => ({ code, seats: g.seats, status: 'available' as const })),
);
