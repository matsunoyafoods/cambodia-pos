// integration-spec.md 3.4 の DDL に対応する型定義。
// メニュー・オプションは matsunoya-dine (public スキーマ) が Master、
// それ以外 (orders, payments, settings, ...) は pos スキーマ。

// 多言語化 (2026-09-02) で追加。日本語 (ja) は既存の name/label 列そのものなので
// translations には含めない。値が無いキー (未翻訳) はUI側で日本語にフォールバックする。
export type MenuLang = 'en' | 'km' | 'zh' | 'ko';
export type TranslationMap = Partial<Record<MenuLang, string>>;

export type OptionChoice = {
  id: string; // choice_key
  label: string;
  priceDelta: number;
  translations?: TranslationMap;
};

export type OptionGroup = {
  key: string;
  label: string;
  required: boolean;
  choices: OptionChoice[];
  translations?: TranslationMap;
};

export type MenuItem = {
  id: string;
  /** 大カテゴリー名 (レジ画面上部のタブに表示される単位)。旧フラット構成の店舗ではこれがそのままカテゴリ名になる */
  category: string;
  /** 大カテゴリーのID (翻訳・並び替え用)。未設定 = 未分類 */
  categoryId?: string;
  categoryTranslations?: TranslationMap;
  /** 中カテゴリー名 (未設定 = 中カテゴリーなし。大カテゴリータブの中で商品をグループ化する見出しに使う) */
  middleCategory?: string;
  middleCategoryId?: string;
  middleCategoryTranslations?: TranslationMap;
  /** 小カテゴリー名 (中カテゴリーが無い場合は大カテゴリー直下の分類名。旧フラット構成では category と同じ値になる) */
  minorCategory: string;
  minorCategoryId?: string;
  minorCategoryTranslations?: TranslationMap;
  name: string;
  translations?: TranslationMap;
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

export type DiscountType = 'percent' | 'fixed';

export type CartLine = {
  id: string; // menuId, or menuId + ':' + 選択choiceIdの組み合わせ
  menuId: string;
  name: string;
  unitPrice: number;
  qty: number;
  selectedOptions: SelectedOption[];
  /** 急遽の値引き (任意、そのラインだけに適用)。'percent' なら discountValue は割引率(%)、
   * 'fixed' なら discountValue はこのライン合計(unitPrice×qty)から引くドル額。未設定 = 値引き無し。 */
  discountType?: DiscountType;
  discountValue?: number;
};

// 客層記録 (来店時の人種構成)。ファースト注文確定時に必須入力。
export const ETHNICITY_KEYS = ['khmer', 'japanese', 'chinese', 'korean', 'western', 'other'] as const;
export type EthnicityKey = (typeof ETHNICITY_KEYS)[number];
export const ETHNICITY_LABELS: Record<EthnicityKey, string> = {
  khmer: 'クメール',
  japanese: '日本人',
  chinese: '中国人',
  korean: '韓国人',
  western: '西洋人',
  other: 'その他',
};
export type GuestEthnicity = Partial<Record<EthnicityKey, number>>;

export type TableStatus = 'available' | 'occupied' | 'billing';

// レジ画面のメニュー写真の見せ方。'compact' = 従来通り小さめ・トリミングあり (一覧性重視、
// 商品数が多い店舗向け)。'full' = 商品全体が切れずに見えるよう大きめ・トリミング無し
// (見た目重視・商品数が少ない店舗向け)。店舗ごとに設定できるようにする (2026-08-31 追加。
// 「画像が見切れます。画像が小さいほうがいい店舗と商品全部が見えてほうがいい店舗と
// わかれると思うので表示される画像を設定できるようにしたほうがいい」)。
export type MenuImageStyle = 'compact' | 'full';

export type TableInfo = {
  code: string;
  seats: number;
  status: TableStatus;
};

// 決済方法の「値」。以前は 'cash'|'qr'|'card' の固定3種類だったが、店舗が自由に決済方法を
// 追加・改名できるようにしたため (2026-08-31 変更。pos.payment_methods 参照)、その時点の
// 表示名をそのまま指す自由文字列になった (例: '現金', 'ABA Pay', 'Wing')。
export type PaymentMethod = string;

// 決済方法マスタ (店舗ごとに自由に追加・並び替え・無効化できる) (2026-08-31 追加)。
export type PaymentMethodConfig = {
  id: string;
  name: string;
  /** 現金として扱うか (預り金額入力・お釣り自動計算UIを出すかどうかの分岐に使う) */
  isCash: boolean;
  enabled: boolean;
  sortOrder: number;
};

// ハンディ注文画面の卓カード表示用グループ (2026-08-31 追加。「ハンディで席をグループ分け
// できるといいね」)。レジ画面の見取り図 (座標配置) とは完全に独立した、ハンディ専用の
// 表示順・グループ分け設定。pos.stores.settings.handyTableGroups (jsonb配列) に保存する。
// id はクライアント側で生成するローカルID (crypto.randomUUID 等)。tableCodes は
// このグループ内での表示順そのもの。どのグループにも属さない卓はハンディ画面側で
// 自動的に「未分類」として末尾にまとめて表示される (設定を何もしなくても卓が消えることはない)。
export type HandyTableGroup = {
  id: string;
  name: string;
  tableCodes: string[];
  /** 卓グループ名の多言語表示用 (2026-09-03 追加。ハンディ画面はスタッフが直接見るため、
   * 未分類などと同じくグループ名も翻訳できるようにする)。未設定の言語は name (日本語) を
   * そのまま表示する。 */
  translations?: TranslationMap;
};

// 会計の1つの支払いライン。1つの伝票を複数の支払い方法・複数人に分けて会計できるようにする
// ため (2026-08-31 追加。「ABAで$10現金で$10」の分割払い、「割り勘」の両方をこの1つの仕組みで
// 表現する — amount は会計全体のうち、このラインが受け持つ金額)。id はクライアント側で
// 生成するローカルID (crypto.randomUUID 等)。現金以外は cashReceivedUsd/Khr は未設定。
export type PaymentLineInput = {
  id: string;
  method: PaymentMethod;
  amount: number;
  cashReceivedUsd?: number;
  cashReceivedKhr?: number;
  changeUsd?: number;
  changeKhr?: number;
};

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
  /** レジ画面のメニュー写真の見せ方 (2026-08-31 追加。未設定 = 'compact') */
  menuImageStyle: MenuImageStyle;
  /** 画面のテーマカラー (2026-09-02 追加。Tom「画面イメージ色もカスタムできるように」への対応)。
   * '#rrggbb' 形式のHEX。未設定 (null) = デフォルトの配色のまま。/pos/* 全体のボタン・アクセント色
   * (--primary, --brand の各CSS変数) に反映される (theme-color-injector.tsx 参照)。 */
  themeColor: string | null;
};

// プリンター実装 (2026-08-31 追加)。レジ画面 (Vercel/クラウド) から店舗LAN内のプリンターへ
// 直接は繋げないため、店舗側で動くローカル印刷エージェント (print-agent、別配布のNode.jsスクリプト)
// が pos.print_jobs をポーリングして実際の印刷を行う。ここではその設定・ジョブの型のみ定義する。
export type PrinterRole = 'receipt' | 'kitchen';
// usb_agent: エージェントが動くPCにUSB接続 (レシートプリンター等、OSのプリンターキュー経由で印刷)
// lan: 店舗LAN上のIPアドレスへエージェントが直接TCP接続 (キッチンプリンター等)
// bluetooth (2026-09-03 追加): エージェントが動くPC/中継機とプリンターをOSのBluetooth(SPP)で
// ペアリングし、割り当てられたシリアルポート/デバイスパスへ直接送信 (常時稼働のPC/中継機が
// 店舗にある場合向け。print-agentを動かすPCが要る)
// passprnt (2026-09-03 追加。店内にPCが無く、レジ端末(iPad/Android)そのものと直接ペアリングする
// 運用向け): Star Micronics純正の無料アプリ「PassPRNT」をレジ端末にインストールし、その端末の
// OS標準Bluetooth設定でプリンターと直接ペアリングする。中継PC・print-agent不要。レジ画面が
// 会計完了時にURLスキーム (starpassprnt://) でレシートHTMLをPassPRNTへ渡し、PassPRNTが印刷して
// 元のブラウザに戻る。この方式は「ブラウザとプリンターが同一端末」であることが前提 (iOS Safari は
// Web Bluetooth 非対応だが、PassPRNT はネイティブアプリなのでこの制約を受けない)。
export type PrinterConnectionType = 'usb_agent' | 'lan' | 'bluetooth' | 'passprnt';

export type PrinterConfig = {
  id: string;
  name: string;
  role: PrinterRole;
  connectionType: PrinterConnectionType;
  paperWidthMm: number;
  /** usb_agent の場合: エージェント側のプリンターキュー名 (例: macOSの `lpstat -p` で確認できる名前)。
   * bluetooth の場合: OSでペアリング後に割り当てられるデバイスパス (例: macOSの `/dev/tty.TSP650II`、
   * Windowsの `COM5` 等)。usb_agent と同じカラムを意味だけ変えて流用している。 */
  deviceName: string | null;
  /** lan の場合の接続先 */
  lanIp: string | null;
  lanPort: number | null;
  enabled: boolean;
};

export type PrintJobStatus = 'pending' | 'printed' | 'failed';
// 'invoice' = 領収書 (宛名・但し書き入りの正式な領収書。レシートとは別に、会計後に
// 客の求めに応じて発行する。2026-08-31 追加)。
export type PrintJobKind = 'receipt' | 'kitchen' | 'invoice' | 'test';

export type PrintJob = {
  id: string;
  printerId: string;
  orderId: string | null;
  kind: PrintJobKind;
  content: string;
  status: PrintJobStatus;
  errorMessage: string | null;
  createdAt: string;
  printedAt: string | null;
};

// レシート・領収書の印字設定 (2026-08-31 追加。「印字設定とレシートの幅設定などできる
// ようにしないといけない」)。pos.stores.settings (jsonb) に保存する (printAgentToken と同じ場所)。
// 用紙幅はプリンターごとの paperWidthMm (PrinterConfig) を印字時にそのまま使うので、
// ここには含めない。
export type ReceiptFormatSettings = {
  /** 店名の下に印字する文言 (住所・電話番号など)。空行区切りで複数行可 */
  headerText: string;
  /** レシート下部に印字する一言 (「またのご来店をお待ちしております」等) */
  footerText: string;
  /** ロゴ画像 (PNG, base64。data:URLプレフィックス無し)。未設定 = ロゴ無し */
  logoPngBase64: string | null;
};

export const DEFAULT_RECEIPT_FORMAT_SETTINGS: ReceiptFormatSettings = {
  headerText: '',
  footerText: '',
  logoPngBase64: null,
};

// 領収書発行フォームの入力 (2026-08-31 追加)。
export type InvoiceInput = {
  /** 宛名 (空欄可 = 「上様」として印字) */
  recipientName: string;
  /** 但し書き (未入力時は「お食事代として」をデフォルトにする) */
  description: string;
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
  menuImageStyle: 'compact',
  themeColor: null,
};

// ---------- 経費管理 (2026-08-31 追加。データ収集・AI分析機能 第一弾) ----------

/** よく使う仕入れ先・買い物先の候補一覧 (owner/manager が登録)。 */
export type ExpenseVendor = { id: string; name: string; sortOrder: number };

/** 経費項目 (雑費・仕入れ等) の候補一覧 (owner/manager が登録)。 */
export type ExpenseCategory = { id: string; name: string; sortOrder: number };

export type ExpensePaymentStatus = 'paid' | 'unpaid';

/** 支払い元 (2026-09-02 追加)。'register_cash' はレジの現金から支払った経費 — 現金残高から
 *  自動で差し引かれる。'other' はそれ以外 (銀行振込・個人の財布からの立て替え等)。 */
export type ExpensePaidFrom = 'register_cash' | 'other';

export type ExpenseRecord = {
  id: string;
  date: string; // 'YYYY-MM-DD'
  amountUsd: number;
  /** 経費項目 (雑費・仕入れ等)。自由文字列のスナップショット (ExpenseCategory は候補一覧に過ぎない) */
  category: string;
  /** 仕入れ先・買い物先。自由文字列のスナップショット (未入力可) */
  vendor: string | null;
  note: string | null;
  /** 'unpaid' = 買掛 (まだ支払っていない)。paidAt を入れて 'paid' に精算できる。 */
  paymentStatus: ExpensePaymentStatus;
  paidAt: string | null;
  /** 'unpaid' の間は意味を持たない (まだ現金が動いていないため)。精算・登録時に確定する。 */
  paidFrom: ExpensePaidFrom;
  receiptImageUrl: string | null;
  createdBy: string | null;
  createdAt: string;
};

// ---------- 勤怠・人件費 (2026-08-31 追加。データ収集・AI分析機能 第一弾) ----------
// シフト作成機能は含めない (Tom確認済み)。出勤・休憩・退勤の記録のみ。

/** 1回の休憩。endedAt が null = 休憩中。 */
export type TimecardBreak = { startedAt: string; endedAt: string | null };

export type TimecardRecord = {
  id: string;
  staffId: string;
  staffName: string;
  clockIn: string;
  clockOut: string | null;
  breaks: TimecardBreak[];
  note: string | null;
  editedBy: string | null;
  editedAt: string | null;
};

/** 打刻の現在状態 (自分の勤怠画面のボタン出し分け用)。 */
export type TimecardStatus = 'not_clocked_in' | 'working' | 'on_break' | 'clocked_out';

// ---------- 勤怠の丸め設定 (2026-09-01 追加。Tom「タイムカードのところに丸め設定を」) ----------
// 打刻の生記録 (clockIn/clockOut) 自体は一切変更しない。人件費レポート・CSV・スタッフ別画像・
// AI分析に使う「実働時間」の集計時にのみ、この設定に従って1回の勤務ごとの実働分数を丸める。
// pos.stores.settings.timecardRounding (jsonb) に保存する (既存の設定と同じパターン)。

export type TimecardRoundingUnit = 5 | 10 | 15 | 30;
export type TimecardRoundingDirection = 'up' | 'down' | 'nearest';

export type TimecardRoundingSettings = {
  enabled: boolean;
  unitMinutes: TimecardRoundingUnit;
  direction: TimecardRoundingDirection;
};

export const DEFAULT_TIMECARD_ROUNDING: TimecardRoundingSettings = {
  enabled: false,
  unitMinutes: 15,
  direction: 'nearest',
};
