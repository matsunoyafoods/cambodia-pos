import type { MenuItem, TableInfo } from './pos-types';

// 本番では GET /api/pos/menus (matsunoya-dine 側 API) から取得する。
// 実装初期はこのデモデータで画面を動かし、Supabase 接続後に差し替える。
export const DEMO_MENU: MenuItem[] = [
  {
    id: 'm1',
    category: 'メイン',
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
    category: 'メイン',
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
  { id: 'm3', category: 'メイン', name: '厚切り牛タン', price: 14 },
  { id: 'm4', category: 'メイン', name: 'サムギョプサル', price: 10 },
  {
    id: 'm5',
    category: 'メイン',
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
  { id: 's1', category: 'サイド', name: 'ライス', price: 2 },
  { id: 's2', category: 'サイド', name: '生野菜サラダ', price: 4 },
  { id: 's3', category: 'サイド', name: 'キムチ盛り合わせ', price: 3 },
  { id: 'd1', category: 'ドリンク', name: 'ソフトドリンク', price: 2 },
  { id: 'd2', category: 'ドリンク', name: 'カンボジアビール', price: 3 },
  { id: 'd3', category: 'ドリンク', name: 'ハウスワイン(グラス)', price: 5 },
];

export const CATEGORIES = ['メイン', 'サイド', 'ドリンク'];

const GROUPS: { label: string; codes: string[]; seats: number }[] = [
  { label: 'Takeaway', codes: ['Takeaway'], seats: 10 },
  { label: 'フロア', codes: ['1', '2', '3', '4', '5'], seats: 4 },
  { label: 'テラス', codes: ['V1', 'V2', 'V3'], seats: 4 },
  { label: '個室', codes: ['BC1', 'BC2', 'BC3', 'BC4', 'BC5', 'BC6'], seats: 4 },
  { label: 'カウンター', codes: ['C1', 'C2', 'C3', 'C4', 'C5'], seats: 2 },
];

export const DEMO_TABLE_GROUPS = GROUPS;

export const DEMO_TABLES: TableInfo[] = GROUPS.flatMap((g) =>
  g.codes.map((code) => ({ code, seats: g.seats, status: 'available' as const })),
);
