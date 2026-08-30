// integration-spec.md 3.4 の DDL に対応する型定義。
// メニュー・オプションは matsunoya-dine (public スキーマ) が Master、
// それ以外 (orders, payments, settings, ...) は pos スキーマ。

export type OptionChoice = {
  id: string; // choice_key
  label: string;
  priceDelta: number;
};

export type OptionGroup = {
  key: string;
  label: string;
  required: boolean;
  choices: OptionChoice[];
};

export type MenuItem = {
  id: string;
  category: string;
  name: string;
  price: number;
  optionGroups?: OptionGroup[];
  /** ハッピーアワー中のみ使う基準価格 (未設定 = ハッピーアワー対象外の商品) */
  happyHourPrice?: number;
  /** 商品画像の公開URL (未設定 = 画像なし、レジ画面ではプレースホルダーアイコン表示) */
  imageUrl?: string;
};

export type SelectedOption = {
  groupKey: string;
  groupLabel: string;
  choiceId: string;
  choiceLabel: string;
  priceDelta: number;
};

export type CartLine = {
  id: string; // menuId, or menuId + ':' + 選択choiceIdの組み合わせ
  menuId: string;
  name: string;
  unitPrice: number;
  qty: number;
  selectedOptions: SelectedOption[];
};

export type TableStatus = 'available' | 'occupied' | 'billing';

export type TableInfo = {
  code: string;
  seats: number;
  status: TableStatus;
};

export type PaymentMethod = 'cash' | 'qr' | 'card';

// pos.settings 1行 (store 単位)
export type PosSettings = {
  storeId: string;
  vatRate: number; // %
  /** true = メニュー価格はVAT込み表示 (内税、VATはsubtotalから逆算し合計には加算しない)。false = 従来通りVAT別 (外税、合計に加算) */
  vatInclusive: boolean;
  serviceRate: number; // %
  khrRate: number; // 1 USD = ? KHR
  cashEnabled: boolean;
  qrEnabled: boolean;
  cardEnabled: boolean;
  /** ハッピーアワー (時間帯価格) 設定。対象商品は pos.menu_items.happy_hour_price 側で管理 */
  happyHourEnabled: boolean;
  happyHourStart: string; // 'HH:MM' (店舗タイムゾーン基準)
  happyHourEnd: string; // 'HH:MM'
};

export const DEFAULT_SETTINGS: PosSettings = {
  storeId: 'default',
  vatRate: 10,
  vatInclusive: false,
  serviceRate: 10,
  khrRate: 4100,
  cashEnabled: true,
  qrEnabled: true,
  cardEnabled: true,
  happyHourEnabled: true,
  happyHourStart: '17:00',
  happyHourEnd: '19:00',
};
