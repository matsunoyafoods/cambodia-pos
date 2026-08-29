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
  serviceRate: number; // %
  khrRate: number; // 1 USD = ? KHR
  cashEnabled: boolean;
  qrEnabled: boolean;
  cardEnabled: boolean;
};

export const DEFAULT_SETTINGS: PosSettings = {
  storeId: 'default',
  vatRate: 10,
  serviceRate: 10,
  khrRate: 4100,
  cashEnabled: true,
  qrEnabled: true,
  cardEnabled: true,
};
