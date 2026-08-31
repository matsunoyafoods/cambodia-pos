'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CartLine,
  DiscountType,
  GuestEthnicity,
  MenuItem,
  PaymentLineInput,
  PaymentMethod,
  PaymentMethodConfig,
  TableStatus,
} from '@/lib/pos-types';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';
import { getPosMenus, getPosSettings, PosApiError } from '@/lib/api-client';
import {
  getPosOrderMenu,
  getPosOrderMode,
  getPosOrderPaymentMethods,
  getPosOrderSettings,
  getPosOrderTableLayout,
  PosOrderApiError,
} from '@/lib/pos-order-client';
import {
  completeOrderPayment,
  confirmOrderItems,
  createOpenOrder,
  deleteConfirmedItem,
  enqueueInvoicePrintJob,
  enqueueKitchenPrintJob,
  enqueueReceiptPrintJob,
  getOpenOrder,
  mergeTables,
  moveTable,
  recordGuestDemographics,
  resetTable,
  updateConfirmedItemDiscount,
  updateConfirmedItemQty,
  PosOrderOrdersApiError,
  type OpenOrderRecord,
  type OrderItemRecord,
} from '@/lib/pos-order-orders-client';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import {
  clearTableSession,
  extendDrinkTimer,
  getTableSessions,
  startDrinkTimer,
  startTableStay,
  type TableSessionRecord,
} from '@/lib/table-session-client';
import { effectiveBasePrice, isHappyHourNow } from '@/lib/happy-hour';
import { cartLineNetTotal, discountAmount } from '@/lib/cart';
import { logoutPosStaff } from '@/lib/staff-client';
import { useStaff } from './staff-context';
import { TableMapScreen } from './table-map-screen';
import { OrderScreen } from './order-screen';
import { CheckoutScreen } from './checkout-screen';
import { ReceiptScreen } from './receipt-screen';
import { OptionModal, type ModalSelection } from './option-modal';
import { GuestDemographicsModal } from './guest-demographics-modal';

type Screen = 'tablemap' | 'order' | 'checkout' | 'receipt';

// 会計完了直後、レシート再印刷・領収書発行に使うためのスナップショット (2026-08-31 追加。
// 「レシートや領収書にロゴ印刷できるようにしたい」の一環で、領収書は会計完了後の別発行に
// したため、confirmedItems/currentOrder を空にした後もこの内容だけは残しておく)。
type CompletedOrderSnapshot = {
  orderId: string | null;
  tableCode: string | null;
  items: { name: string; qty: number; lineTotal: number }[];
  subtotal: number;
  vat: number;
  vatRate: number;
  vatInclusive: boolean;
  service: number;
  serviceRate: number;
  couponDiscount: number;
  orderDiscount: number;
  total: number;
  payments: { method: PaymentMethod; amount: number }[];
};

// PosApp は旧 UI プロトタイプ (design canvas の Main.dc.html) の状態遷移を
// そのまま React に移植したもの。本番接続 (Supabase / matsunoya-dine API) は
// 各 on* ハンドラの中身を差し替えていく想定 (integration-spec.md 4章のエンドポイント対応)。
export function PosApp() {
  const router = useRouter();
  const me = useStaff();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [layoutItems, setLayoutItems] = useState<TableLayoutItemRecord[]>([]);
  const [tableSessions, setTableSessions] = useState<TableSessionRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loadToken, setLoadToken] = useState(0);

  const [screen, setScreen] = useState<Screen>('tablemap');
  const [statusFilter, setStatusFilter] = useState<'all' | TableStatus>('all');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  // 席移動・会計合算 (2026-08-31 追加)。テーブルマップ上でのモード切り替え式の2ステップ操作。
  const [tableActionMode, setTableActionMode] = useState<'none' | 'move' | 'merge'>('none');
  const [moveSourceTable, setMoveSourceTable] = useState<string | null>(null);
  const [mergeTargetTable, setMergeTargetTable] = useState<string | null>(null);
  const [mergeSourceTables, setMergeSourceTables] = useState<string[]>([]);
  const [tableActionBusy, setTableActionBusy] = useState(false);
  const [tableActionError, setTableActionError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerLinked, setCustomerLinked] = useState(false);
  const [couponApplied, setCouponApplied] = useState(false);
  // 会計画面の合計から直接かける急遽の値引き (%引き・$引き)。ラインごとの値引きとは別枠で、
  // 顧客紐付け不要 (2026-08-31 追加。「合計の会計から割引ができるようにもしてほしい」)。
  const [orderDiscount, setOrderDiscount] = useState<{ type: DiscountType; value: number } | null>(null);
  // 会計の支払いライン一覧。分割払い ($10 ABA + $10 現金) や割り勘 (人数で分けて個別に会計) に
  // 対応するため、単一の支払い方法ではなく配列で保持する (2026-08-31 追加)。各ラインの入力途中
  // の値 (どの支払い方法を選んでいるか、お預かり金額など) は checkout-screen.tsx 側のローカル
  // stateで、確定して追加されたラインだけここに積み上がる。画面遷移をまたいでも保持したいので
  // (会計画面↔注文画面を行き来しても入力済みの支払いが消えないように) pos-app 側に置く。
  const [paymentLines, setPaymentLines] = useState<PaymentLineInput[]>([]);
  // 有効な決済方法一覧 (店舗が設定画面で自由に追加できる。2026-08-31 追加)。
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [optionModalItem, setOptionModalItem] = useState<MenuItem | null>(null);
  const [optionSelection, setOptionSelection] = useState<ModalSelection>({});

  // この卓の「開いている伝票」(pos.orders, status='open')。null = まだファースト注文が
  // 確定されていない (=客層記録が済んでいない) 卓。confirmedItems はサーバーに確定済みの品目
  // (画面をリロードしたり卓一覧に戻ってきても消えない)。cart はまだ「注文確定」していない
  // ローカルの新規ラウンド分 (これはこれまで通り画面遷移で失われうる = 意図通りの挙動)。
  const [currentOrder, setCurrentOrder] = useState<OpenOrderRecord | null>(null);
  const [confirmedItems, setConfirmedItems] = useState<OrderItemRecord[]>([]);
  // 会計完了時点の合計額のスナップショット。totals は confirmedItems から算出される
  // (useMemo) ため、会計完了後に confirmedItems を空にすると totals.total も 0 に戻ってしまい、
  // レシート画面にそのまま totals.total を渡すと $0.00 と表示されてしまう。そのためレシート
  // 表示用にこの値だけ別で保持する。
  const [receiptTotal, setReceiptTotal] = useState(0);
  // 会計完了直後のスナップショット (レシート再印刷・領収書発行用。2026-08-31 追加)。
  const [lastCompletedOrder, setLastCompletedOrder] = useState<CompletedOrderSnapshot | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceIssued, setInvoiceIssued] = useState(false);
  const [reprintBusy, setReprintBusy] = useState(false);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [guestSaving, setGuestSaving] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // pos_native モード: レジ画面タブの並び順はサーバーが返す大カテゴリーの sort_order 順
  // (setPosNativeCategoryOrder、設定画面から自由に並び替え可能 2026-08-31) をそのまま使う。
  // dine_live (matsunoya-dine 連携) モードはそのような並び順情報が無いため、従来通り
  // メニューに商品が初めて出てきた順で代用する。
  const [posNativeCategoryOrder, setPosNativeCategoryOrder] = useState<string[] | null>(null);
  const categories = useMemo(() => {
    if (posNativeCategoryOrder) {
      const present = new Set(menu.map((m) => m.category));
      return posNativeCategoryOrder.filter((c) => present.has(c));
    }
    const seen: string[] = [];
    for (const m of menu) {
      if (!seen.includes(m.category)) seen.push(m.category);
    }
    return seen;
  }, [menu, posNativeCategoryOrder]);

  // Phase C: まず /api/pos-order/mode (POS_STORE_ID 店舗の pos.integrations.menu_source) を見て、
  // 'pos_native' なら POS ネイティブの実データ (pos.menu_items 等) を、それ以外 (未移行 = 'dine_live')
  // なら従来通り matsunoya-dine 側の /api/pos/menus + /api/pos/settings を使う。
  // 連携先を切り替えていない既存店舗の挙動は変わらない (multi-tenant-productization-spec.md Phase C)。
  // loadToken を更新すると再フェッチする (エラー時の「再読み込み」ボタン用)。
  useEffect(() => {
    let cancelled = false;
    setDataLoading(true);
    setDataError(null);
    (async () => {
      try {
        const { menuSource } = await getPosOrderMode();
        // テーブルレイアウトは連携モードに関係なく POS ネイティブの pos.table_layouts
        // から読む (設定画面「テーブルレイアウト」で作った見取り図)。まだ何も配置して
        // いない店舗向けに、失敗・0件時は空配列のまま (table-map-screen.tsx 側で
        // 既存のサンプル配置にフォールバックする)。
        const layoutPromise = getPosOrderTableLayout().catch(() => ({ items: [] as TableLayoutItemRecord[] }));
        // 滞在タイマー・飲み放題タイマーは連携モードに関係なく卓単位で動く (pos.table_sessions)。
        const sessionsPromise = getTableSessions().catch(() => ({ items: [] as TableSessionRecord[] }));
        // 決済方法は連携モードに関係なく pos.payment_methods (店舗単位) から読む
        // (2026-08-31 追加。未設定でも会計自体は止めたくないので失敗時は空配列)。
        const paymentMethodsPromise = getPosOrderPaymentMethods().catch(() => ({ paymentMethods: [] as PaymentMethodConfig[] }));
        if (menuSource === 'pos_native') {
          const [menuData, settingsData, layoutData, sessionsData, paymentMethodsData] = await Promise.all([
            getPosOrderMenu(),
            getPosOrderSettings(),
            layoutPromise,
            sessionsPromise,
            paymentMethodsPromise,
          ]);
          if (cancelled) return;
          setMenu(menuData.items);
          setPosNativeCategoryOrder(menuData.categories);
          setSettings((prev) => ({ ...prev, ...settingsData }));
          setLayoutItems(layoutData.items);
          setTableSessions(sessionsData.items);
          setPaymentMethods(paymentMethodsData.paymentMethods);
        } else {
          const [menuData, settingsData, layoutData, sessionsData, paymentMethodsData] = await Promise.all([
            getPosMenus(),
            getPosSettings(),
            layoutPromise,
            sessionsPromise,
            paymentMethodsPromise,
          ]);
          if (cancelled) return;
          setMenu(
            menuData.map((m) => {
              const category = m.category ?? '未分類';
              return { ...m, category, minorCategory: category };
            }),
          );
          setPosNativeCategoryOrder(null);
          setSettings((prev) => ({ ...prev, ...settingsData }));
          setLayoutItems(layoutData.items);
          setTableSessions(sessionsData.items);
          setPaymentMethods(paymentMethodsData.paymentMethods);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof PosApiError || err instanceof PosOrderApiError
            ? err.message
            : 'メニュー・設定の取得に失敗しました。通信環境を確認してください。';
        setDataError(message);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadToken]);

  // メニュー取得後、最初のカテゴリを選択状態にする
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  // 滞在タイマー・飲み放題タイマーは他の端末やスタッフの操作でも変わるため、
  // 定期的に再取得してテーブルマップ・注文画面の表示を最新に保つ。
  useEffect(() => {
    if (dataLoading) return;
    const id = setInterval(() => {
      getTableSessions()
        .then(({ items }) => setTableSessions(items))
        .catch(() => {
          /* ポーリング失敗時は次回まで前回値を表示し続ける */
        });
    }, 20000);
    return () => clearInterval(id);
  }, [dataLoading]);

  // 卓の使用状況は「現在アクティブな来店セッションがあるか」から導出する
  // (以前はデモ用に BC3/C2 を固定で使用中・会計待ち扱いにしていた)。
  // 会計画面を開いている卓は、この端末上では「会計待ち」として上書き表示する。
  const tableStatus: Record<string, TableStatus> = useMemo(() => {
    const status: Record<string, TableStatus> = {};
    for (const s of tableSessions) status[s.table_code] = 'occupied';
    if (screen === 'checkout' && selectedTable) status[selectedTable] = 'billing';
    return status;
  }, [tableSessions, screen, selectedTable]);

  // ハッピーアワー判定用の「現在時刻」。時間帯をまたいだ時にすぐ切り替わるよう定期的に更新する。
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const happyHourActive = useMemo(() => isHappyHourNow(settings, now), [settings, now]);

  function upsertLocalSession(tableCode: string, patch: Partial<TableSessionRecord>) {
    setTableSessions((prev) => {
      const idx = prev.findIndex((s) => s.table_code === tableCode);
      if (idx === -1) {
        return [
          ...prev,
          {
            table_code: tableCode,
            started_at: new Date().toISOString(),
            drink_timer_started_at: null,
            drink_timer_minutes: 0,
            ...patch,
          },
        ];
      }
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  // 注文品目がカートに追加される全ての箇所 (量目・オプション不要な商品の即時追加、
  // オプションモーダル確定の両方) から呼ぶ。「注文商品を入力すると同時に滞在タイマーが
  // 発動」「飲み放題メニューを注文すると飲み放題タイマーが発動」に対応する副作用。
  function onOrderItemEntered(item: MenuItem) {
    if (!selectedTable) return;
    if (cart.length === 0 && !tableSessions.some((s) => s.table_code === selectedTable)) {
      upsertLocalSession(selectedTable, {});
      startTableStay(selectedTable).catch(() => {
        /* 反映失敗時は次回ポーリングで補正される */
      });
    }
    if (item.category === '飲み放題') {
      const existing = tableSessions.find((s) => s.table_code === selectedTable);
      if (item.name.includes('延長')) {
        const addMinutes = 30;
        upsertLocalSession(selectedTable, {
          drink_timer_started_at: existing?.drink_timer_started_at ?? new Date().toISOString(),
          drink_timer_minutes: (existing?.drink_timer_minutes ?? 0) + addMinutes,
        });
        extendDrinkTimer(selectedTable, addMinutes).catch(() => {});
      } else if (!existing?.drink_timer_started_at) {
        const minutes = 60;
        upsertLocalSession(selectedTable, { drink_timer_started_at: new Date().toISOString(), drink_timer_minutes: minutes });
        startDrinkTimer(selectedTable, minutes).catch(() => {});
      }
    }
  }

  const totals = useMemo(() => {
    // 確定済み (サーバーに保存済み、注文確定/会計へ進むを押した分) + 未確定 (このラウンドの
    // カート) を合算して計算する。
    const confirmedSubtotal = confirmedItems.reduce((s, it) => s + it.line_total, 0);
    // カートの各ラインの急遽の値引き (cartLineDiscount) を反映した金額で合算する。
    const cartSubtotal = cart.reduce((s, l) => s + cartLineNetTotal(l), 0);
    const subtotal = confirmedSubtotal + cartSubtotal;
    // 税込み(内税)設定の場合、メニュー価格に既にVATが含まれているものとして扱う。
    // VAT額は内訳表示用にsubtotalから逆算するだけで、合計には加算しない
    // (サービス料は税別・税込みどちらでも合計に加算する)。
    const vat = settings.vatInclusive
      ? subtotal - subtotal / (1 + settings.vatRate / 100)
      : subtotal * (settings.vatRate / 100);
    const service = subtotal * (settings.serviceRate / 100);
    // 2026-08-31 方針決定 (Tomさん): 値引き (クーポン・会計からの割引) は税抜き部分 + サービス料
    // までしか対象にできず、VATは値引き後も必ず請求する。以前は税込み設定の場合、値引きが
    // VATごと丸ごと打ち消してしまい ($5の商品に$5引くと合計$0円) 、フル値引きの伝票でVATが
    // 一切請求されない状態になっていた。「税抜き土台+サービス料」というプール (discountable)
    // から値引きを順番に (クーポン→会計からの割引の順で) 消費させ、使い切ったら以降は
    // VATだけが残る形にする。値引きが小さければ従来通りの計算結果と変わらない。
    const base = settings.vatInclusive ? subtotal - vat : subtotal;
    let discountable = base + service;
    const requestedCouponDiscount = couponApplied ? Math.min(5, subtotal) : 0;
    const couponDiscount = Math.min(requestedCouponDiscount, discountable);
    discountable -= couponDiscount;
    // 会計画面の合計からの急遽の値引き。ライン値引き・クーポンとは独立に、subtotal を基準に
    // 計算する (％引きなら subtotal に対する割合、＄引きなら subtotal を上限とするドル額)。
    const requestedOrderDiscount = discountAmount(subtotal, orderDiscount?.type, orderDiscount?.value);
    const appliedOrderDiscount = Math.min(requestedOrderDiscount, discountable);
    discountable -= appliedOrderDiscount;
    const total = Math.max(0, discountable + vat);
    return { subtotal, vat, service, couponDiscount, orderDiscount: appliedOrderDiscount, total };
  }, [cart, confirmedItems, couponApplied, orderDiscount, settings.vatRate, settings.vatInclusive, settings.serviceRate]);

  function resetOrderState() {
    setCustomerLinked(false);
    setCouponApplied(false);
    setOrderDiscount(null);
    setPaymentLines([]);
    setOptionModalItem(null);
    setOptionSelection({});
    setGuestModalOpen(false);
    setGuestError(null);
    setConfirmError(null);
    setCompleteError(null);
  }

  // テーブル選択のたびに、この卓の「開いている伝票」をサーバーから取り直す。以前は cart を
  // 空にするだけで終わっていたため、卓一覧に戻ってから同じ卓に入り直すと確定済みの注文まで
  // 消えてしまうバグがあった (画面ローカルの state しか無く、どこにも保存されていなかったため)。
  // 今は「注文確定」/「会計へ進む」を押した時点でサーバー (pos.orders/order_items) に保存され、
  // ここで読み直すので卓一覧との往復や再読み込みでも確定済み分は残る。
  function selectTable(code: string) {
    setSelectedTable(code);
    setCart([]);
    setConfirmedItems([]);
    setCurrentOrder(null);
    setActiveCategory(categories[0] ?? '');
    resetOrderState();
    setScreen('order');
    getOpenOrder(code)
      .then(({ order, items }) => {
        setCurrentOrder(order);
        setConfirmedItems(items);
      })
      .catch(() => {
        /* 取得失敗時は「まだ開いている伝票が無い」扱いのまま (ファースト注文時に作り直せる) */
      });
  }

  // 席移動・会計合算 (2026-08-31 追加)。テーブルマップの「席移動」「会計合算」カードから開始する。
  function startMoveMode() {
    setTableActionMode('move');
    setMoveSourceTable(null);
    setTableActionError(null);
  }
  function startMergeMode() {
    setTableActionMode('merge');
    setMergeTargetTable(null);
    setMergeSourceTables([]);
    setTableActionError(null);
  }
  function cancelTableAction() {
    setTableActionMode('none');
    setMoveSourceTable(null);
    setMergeTargetTable(null);
    setMergeSourceTables([]);
    setTableActionError(null);
  }

  function refreshTableSessions() {
    getTableSessions()
      .then(({ items }) => setTableSessions(items))
      .catch(() => {});
  }

  async function handleTableTapForAction(code: string) {
    setTableActionError(null);

    if (tableActionMode === 'move') {
      if (!moveSourceTable) {
        if ((tableStatus[code] ?? 'available') === 'available') {
          setTableActionError('移動元は使用中のテーブルを選んでください');
          return;
        }
        setMoveSourceTable(code);
        return;
      }
      if (code === moveSourceTable) {
        setMoveSourceTable(null);
        return;
      }
      if ((tableStatus[code] ?? 'available') !== 'available') {
        setTableActionError('移動先は空いているテーブルを選んでください');
        return;
      }
      setTableActionBusy(true);
      try {
        await moveTable(moveSourceTable, code);
        refreshTableSessions();
        if (selectedTable === moveSourceTable) setSelectedTable(code);
        cancelTableAction();
      } catch (err) {
        setTableActionError(err instanceof PosOrderOrdersApiError ? err.message : '席移動に失敗しました');
      } finally {
        setTableActionBusy(false);
      }
      return;
    }

    if (tableActionMode === 'merge') {
      if (!mergeTargetTable) {
        if ((tableStatus[code] ?? 'available') === 'available') {
          setTableActionError('残すテーブル (合算先) は使用中のテーブルを選んでください');
          return;
        }
        setMergeTargetTable(code);
        return;
      }
      if (code === mergeTargetTable) {
        setMergeTargetTable(null);
        setMergeSourceTables([]);
        return;
      }
      if ((tableStatus[code] ?? 'available') === 'available') {
        setTableActionError('合算するテーブルは使用中のテーブルを選んでください');
        return;
      }
      setMergeSourceTables((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    }
  }

  async function confirmMerge() {
    if (!mergeTargetTable || mergeSourceTables.length === 0) return;
    setTableActionBusy(true);
    setTableActionError(null);
    try {
      await mergeTables(mergeTargetTable, mergeSourceTables);
      refreshTableSessions();
      cancelTableAction();
    } catch (err) {
      setTableActionError(err instanceof PosOrderOrdersApiError ? err.message : '会計合算に失敗しました');
    } finally {
      setTableActionBusy(false);
    }
  }

  function addToCart(item: MenuItem) {
    onOrderItemEntered(item);
    const unitPrice = effectiveBasePrice(item, happyHourActive);
    setCart((prev) => {
      const existing = prev.find((l) => l.id === item.id);
      if (existing) return prev.map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { id: item.id, menuId: item.id, name: item.name, unitPrice, qty: 1, selectedOptions: [] }];
    });
  }

  function incLine(id: string) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)));
  }
  function decLine(id: string) {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0));
  }

  // カートのライン (未確定分) に急遽の値引きを設定・解除する。「注文確定」して厨房送信済みに
  // なったライン (confirmedItems) は後から値引きできない (既に厨房・伝票に確定済みのため)。
  // discount=null で値引き解除。
  function setLineDiscount(id: string, discount: { type: 'percent' | 'fixed'; value: number } | null) {
    setCart((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, discountType: discount?.type, discountValue: discount?.value } : l,
      ),
    );
  }

  // 確定済み (厨房送信済み) の品目に、後から値引きを設定・変更・解除する (2026-08-31 追加)。
  // サーバー (PATCH) が menu_name・line_total を再計算して返すので、その結果でローカルの
  // confirmedItems を差し替える。
  async function setConfirmedItemDiscount(
    itemId: string,
    discount: { type: 'percent' | 'fixed'; value: number } | null,
  ) {
    if (!currentOrder) return;
    const { item } = await updateConfirmedItemDiscount(currentOrder.id, itemId, discount);
    setConfirmedItems((prev) => prev.map((it) => (it.id === itemId ? item : it)));
  }

  // 確定済み品目の数量+/-・削除 (2026-08-31 追加。「カートに一度注文済みになると削除や変更が
  // できません。できるようにしてください」)。数量を1未満にはできない — 0にしたい場合は
  // removeConfirmedItem (削除ボタン) を明示的に使う設計にして、連打による誤削除を防ぐ。
  async function incConfirmedItemQty(itemId: string) {
    if (!currentOrder) return;
    const target = confirmedItems.find((it) => it.id === itemId);
    if (!target) return;
    const { item } = await updateConfirmedItemQty(currentOrder.id, itemId, target.qty + 1);
    setConfirmedItems((prev) => prev.map((it) => (it.id === itemId ? item : it)));
  }

  async function decConfirmedItemQty(itemId: string) {
    if (!currentOrder) return;
    const target = confirmedItems.find((it) => it.id === itemId);
    if (!target || target.qty <= 1) return;
    const { item } = await updateConfirmedItemQty(currentOrder.id, itemId, target.qty - 1);
    setConfirmedItems((prev) => prev.map((it) => (it.id === itemId ? item : it)));
  }

  async function removeConfirmedItem(itemId: string) {
    if (!currentOrder) return;
    await deleteConfirmedItem(currentOrder.id, itemId);
    setConfirmedItems((prev) => prev.filter((it) => it.id !== itemId));
  }

  // オプション選択が必要な商品ならモーダルを開き、不要ならそのままカートに追加する。
  // 客層記録が既に済んでいる (currentOrder がある) ことが前提。
  function proceedAddItem(item: MenuItem) {
    if (item.optionGroups && item.optionGroups.length > 0) {
      setOptionModalItem(item);
      setOptionSelection({});
    } else {
      addToCart(item);
    }
  }

  // この卓でまだ open 注文が無ければ (=ファースト注文) 卓を開いてから商品を追加する。
  // 客層記録は 2026-08-31 よりここでは行わない (「会計へ進む」時に移動。handleCheckout 参照)。
  async function onAddItem(item: MenuItem) {
    if (!currentOrder) {
      if (!selectedTable) return;
      try {
        const { order } = await createOpenOrder({ tableCode: selectedTable, staffId: me.id });
        setCurrentOrder(order);
        proceedAddItem(item);
      } catch (err) {
        window.alert(err instanceof PosOrderOrdersApiError ? err.message : '卓を開けませんでした');
      }
      return;
    }
    proceedAddItem(item);
  }

  // 客層記録 (2026-08-31 変更: 「会計へ進む」ボタンを押した時に挟むよう移動。理由は
  // handleCheckout のコメント参照)。保存できたら会計画面へ進む。
  async function handleGuestConfirm(ethnicity: GuestEthnicity, kidsCount: number) {
    if (!currentOrder) return;
    setGuestSaving(true);
    setGuestError(null);
    try {
      const { order } = await recordGuestDemographics(currentOrder.id, {
        guestEthnicity: ethnicity,
        guestKidsCount: kidsCount,
        staffId: me.id,
      });
      setCurrentOrder(order);
      setGuestModalOpen(false);
      setScreen('checkout');
    } catch (err) {
      setGuestError(err instanceof PosOrderOrdersApiError ? err.message : '客層の保存に失敗しました');
    } finally {
      setGuestSaving(false);
    }
  }

  function handleGuestCancel() {
    setGuestModalOpen(false);
  }

  // 「注文確定」: このラウンドのカートを厨房送信済みとしてサーバーに保存し、確定済み一覧に
  // 積み上げる。成功したらローカルのカートは空にする (次のラウンドの入力に備える)。
  async function confirmPendingCart(): Promise<boolean> {
    if (cart.length === 0) return true;
    if (!currentOrder) return false;
    setConfirming(true);
    setConfirmError(null);
    try {
      const { items } = await confirmOrderItems(currentOrder.id, cart);
      setConfirmedItems((prev) => [...prev, ...items]);
      setCart([]);
      // 厨房伝票の印刷キューへ (プリンター未設定の店舗では静かに何もしない)。会計自体を
      // 止めたくないので失敗しても無視する (2026-08-31 プリンター実装で追加。同日、
      // 用紙幅・整形はサーバー側でプリンターごとに行うよう変更したため、生データだけ渡す)。
      enqueueKitchenPrintJob({
        orderId: currentOrder.id,
        tableCode: selectedTable,
        items: items.map((it) => ({ name: it.menu_name, qty: it.qty })),
      }).catch(() => {
        /* プリンター未接続でも注文確定自体は成功させる */
      });
      return true;
    } catch (err) {
      setConfirmError(err instanceof PosOrderOrdersApiError ? err.message : '注文の確定に失敗しました');
      return false;
    } finally {
      setConfirming(false);
    }
  }

  // 「会計へ進む」: 未確定のカートが残っていれば先に注文確定してから会計画面へ (確定漏れのまま
  // 会計に進んでカートの中身が消えることが無いようにする)。
  // 2026-08-31 変更 (Tomさんの要望): 客層記録がまだの注文はここで先に記録してもらう
  // (以前はファースト注文時に必須だったが、「あとで人数が増えた場合にも対応でき、会計の
  // 時だと少し余裕がある」ため会計へ進むタイミングに移動した)。キャンセルすれば注文画面に
  // 留まる (会計画面へは進まない)。
  async function handleCheckout() {
    if (cart.length === 0 && confirmedItems.length === 0) return;
    const ok = await confirmPendingCart();
    if (!ok) return;
    if (currentOrder && !currentOrder.guest_recorded_at) {
      setGuestError(null);
      setGuestModalOpen(true);
      return;
    }
    setScreen('checkout');
  }

  function confirmOptionModal() {
    if (!optionModalItem) return;
    const groups = optionModalItem.optionGroups ?? [];
    if (!groups.every((g) => optionSelection[g.key])) return;
    onOrderItemEntered(optionModalItem);

    const priceDeltaTotal = groups.reduce((sum, g) => {
      const choice = g.choices.find((c) => c.id === optionSelection[g.key]);
      return sum + (choice ? choice.priceDelta : 0);
    }, 0);
    const optionLabel = groups
      .map((g) => g.choices.find((c) => c.id === optionSelection[g.key])?.label ?? '')
      .join('・');
    const lineId = optionModalItem.id + ':' + groups.map((g) => optionSelection[g.key]).join(',');
    const unitPrice = effectiveBasePrice(optionModalItem, happyHourActive) + priceDeltaTotal;
    const selectedOptions = groups.map((g) => {
      const choice = g.choices.find((c) => c.id === optionSelection[g.key])!;
      return { groupKey: g.key, groupLabel: g.label, choiceId: choice.id, choiceLabel: choice.label, priceDelta: choice.priceDelta };
    });

    setCart((prev) => {
      const existing = prev.find((l) => l.id === lineId);
      if (existing) return prev.map((l) => (l.id === lineId ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...prev,
        {
          id: lineId,
          menuId: optionModalItem.id,
          name: `${optionModalItem.name}(${optionLabel})`,
          unitPrice,
          qty: 1,
          selectedOptions,
        },
      ];
    });
    setOptionModalItem(null);
    setOptionSelection({});
  }

  // 支払いラインの合計 (= 実際に集まった金額)。会計完了ボタンはこれが合計以上になるまで
  // 無効化する (checkout-screen.tsx 側の canComplete)。
  const paymentLinesTotal = paymentLines.reduce((s, l) => s + l.amount, 0);

  function addPaymentLine(line: Omit<PaymentLineInput, 'id'>) {
    setPaymentLines((prev) => [...prev, { ...line, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }]);
  }
  function removePaymentLine(id: string) {
    setPaymentLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function completeOrder() {
    if (!currentOrder || completing) return;
    if (paymentLinesTotal < totals.total - 0.01) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await completeOrderPayment(currentOrder.id, {
        subtotal: totals.subtotal,
        vat: totals.vat,
        service: totals.service,
        couponDiscount: totals.couponDiscount,
        orderDiscount: totals.orderDiscount,
        total: totals.total,
        payments: paymentLines.map((l) => ({
          method: l.method,
          amount: l.amount,
          cashReceivedUsd: l.cashReceivedUsd,
          cashReceivedKhr: l.cashReceivedKhr,
          changeUsd: l.changeUsd,
          changeKhr: l.changeKhr,
        })),
      });
      // レシートの印刷キューへ (プリンター未設定の店舗では静かに何もしない)。会計完了自体は
      // 既に成功しているので失敗しても無視する (2026-08-31 プリンター実装で追加。同日、
      // 用紙幅・ヘッダー/フッター文言・ロゴはサーバー側でプリンターごとに当てはめるよう
      // 変更したため、生データだけ渡す)。
      const snapshotItems = confirmedItems.map((it) => ({ name: it.menu_name, qty: it.qty, lineTotal: it.line_total }));
      const snapshotPayments = paymentLines.map((l) => ({ method: l.method, amount: l.amount }));
      enqueueReceiptPrintJob({
        orderId: currentOrder.id,
        tableCode: selectedTable,
        items: snapshotItems,
        subtotal: totals.subtotal,
        vat: totals.vat,
        vatRate: settings.vatRate,
        vatInclusive: settings.vatInclusive,
        service: totals.service,
        serviceRate: settings.serviceRate,
        couponDiscount: totals.couponDiscount,
        orderDiscount: totals.orderDiscount,
        total: totals.total,
        payments: snapshotPayments,
      }).catch(() => {
        /* プリンター未接続でも会計完了自体は成功させる */
      });
      // レシート画面での「再印刷」「領収書を発行」用に、確定済み品目・合計をクリアする前の
      // 内容をスナップショットとして残しておく (2026-08-31 追加)。
      setLastCompletedOrder({
        orderId: currentOrder.id,
        tableCode: selectedTable,
        items: snapshotItems,
        subtotal: totals.subtotal,
        vat: totals.vat,
        vatRate: settings.vatRate,
        vatInclusive: settings.vatInclusive,
        service: totals.service,
        serviceRate: settings.serviceRate,
        couponDiscount: totals.couponDiscount,
        orderDiscount: totals.orderDiscount,
        total: totals.total,
        payments: snapshotPayments,
      });
      setInvoiceIssued(false);
      setInvoiceError(null);
      // 会計完了 = この卓の来店セッションが終わるので、滞在・飲み放題タイマーをリセットする。
      if (selectedTable) {
        setTableSessions((prev) => prev.filter((s) => s.table_code !== selectedTable));
        clearTableSession(selectedTable).catch(() => {
          /* 反映失敗時は次回ポーリングで補正される */
        });
      }
      setReceiptTotal(totals.total);
      setCurrentOrder(null);
      setConfirmedItems([]);
      setScreen('receipt');
    } catch (err) {
      setCompleteError(err instanceof PosOrderOrdersApiError ? err.message : '会計の確定に失敗しました');
    } finally {
      setCompleting(false);
    }
  }

  // テーブルリセット: 会計せずに、間違えて選択・注文した卓を空席へ戻す (2026-08-31 追加)。
  // 開いている伝票は void 扱いになり、この端末のカート・確定済み品目もすべて破棄される。
  // 取り消せない操作なので window.confirm で必ず確認する (order-screen.tsx の削除確認と同じ方針)。
  async function resetCurrentTable() {
    if (!selectedTable) return;
    if (
      !window.confirm(
        `テーブル ${selectedTable} をリセットしますか？\n入力した注文はすべて破棄され、会計は行われません。この操作は取り消せません。`,
      )
    ) {
      return;
    }
    try {
      await resetTable(selectedTable);
    } catch (err) {
      window.alert(err instanceof PosOrderOrdersApiError ? err.message : 'テーブルのリセットに失敗しました');
      return;
    }
    setTableSessions((prev) => prev.filter((s) => s.table_code !== selectedTable));
    setScreen('tablemap');
    setSelectedTable(null);
    setCart([]);
    setConfirmedItems([]);
    setCurrentOrder(null);
    resetOrderState();
  }

  // 顧客控え(レシート)の再印刷 (2026-08-31 追加。以前から画面にボタンはあったが未接続だった)。
  async function reprintReceipt() {
    if (!lastCompletedOrder || reprintBusy) return;
    setReprintBusy(true);
    try {
      await enqueueReceiptPrintJob({
        orderId: lastCompletedOrder.orderId ?? undefined,
        tableCode: lastCompletedOrder.tableCode,
        items: lastCompletedOrder.items,
        subtotal: lastCompletedOrder.subtotal,
        vat: lastCompletedOrder.vat,
        vatRate: lastCompletedOrder.vatRate,
        vatInclusive: lastCompletedOrder.vatInclusive,
        service: lastCompletedOrder.service,
        serviceRate: lastCompletedOrder.serviceRate,
        couponDiscount: lastCompletedOrder.couponDiscount,
        orderDiscount: lastCompletedOrder.orderDiscount,
        total: lastCompletedOrder.total,
        payments: lastCompletedOrder.payments,
      });
    } catch {
      /* レシート画面には出さず、印刷が来なければスタッフがテスト印刷等で気づく想定 */
    } finally {
      setReprintBusy(false);
    }
  }

  // 領収書 (宛名・但し書き入りの正式な領収書) の発行 (2026-08-31 追加。「宛名・但し書き入りの
  // 正式な領収書を別途発行する機能が必要」)。会計直後のレシート画面から、客の求めに応じて発行する。
  function makeInvoiceNo(orderId: string | null, at: Date): string {
    const ymd = at.toISOString().slice(0, 10).replace(/-/g, '');
    const idPart = (orderId ?? '').replace(/-/g, '').slice(-4).toUpperCase();
    const suffix = idPart || Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${ymd}-${suffix}`;
  }

  async function issueInvoice(recipientName: string, description: string) {
    if (!lastCompletedOrder) return;
    setInvoiceBusy(true);
    setInvoiceError(null);
    try {
      await enqueueInvoicePrintJob({
        orderId: lastCompletedOrder.orderId ?? undefined,
        recipientName,
        description,
        total: lastCompletedOrder.total,
        invoiceNo: makeInvoiceNo(lastCompletedOrder.orderId, new Date()),
      });
      setInvoiceIssued(true);
    } catch (err) {
      setInvoiceError(err instanceof PosOrderOrdersApiError ? err.message : '領収書の発行に失敗しました');
    } finally {
      setInvoiceBusy(false);
    }
  }

  function newOrder() {
    setScreen('tablemap');
    setSelectedTable(null);
    setCart([]);
    setConfirmedItems([]);
    setCurrentOrder(null);
    resetOrderState();
  }

  if (dataLoading) {
    return (
      <div className="flex h-[800px] w-[1280px] flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <div className="text-sm">メニュー・設定を読み込み中…</div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="flex h-[800px] w-[1280px] flex-col items-center justify-center gap-4 bg-background px-10 text-center">
        <div className="text-sm font-semibold text-destructive">{dataError}</div>
        <button
          onClick={() => setLoadToken((t) => t + 1)}
          className="h-10 rounded-lg bg-primary px-5 text-[13.5px] font-bold text-primary-foreground"
        >
          再読み込み
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-[800px] w-[1280px] flex-col overflow-hidden bg-background">
      <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground">
            住
          </div>
          <div className="text-base font-bold tracking-tight">I&apos;mHungry POS</div>
        </div>
        <div className="flex items-center gap-3.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            オンライン
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="メニュー"
              className="flex h-[34px] w-[34px] flex-col items-center justify-center gap-[3px] rounded-full bg-secondary"
            >
              <span className="h-[2px] w-4 rounded-full bg-foreground" />
              <span className="h-[2px] w-4 rounded-full bg-foreground" />
              <span className="h-[2px] w-4 rounded-full bg-foreground" />
            </button>
            {menuOpen && (
              <>
                <button
                  aria-label="close menu"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-56 rounded-xl border border-border bg-card py-1.5 shadow-lg">
                  <div className="border-b border-border px-3.5 py-2.5">
                    <div className="text-[13px] font-semibold">{me.display_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {{ owner: 'オーナー', manager: 'マネージャー', staff: 'スタッフ' }[me.role]}
                    </div>
                  </div>
                  <button
                    onClick={() => router.push('/pos/settings')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    設定
                  </button>
                  <button
                    onClick={() => router.push('/pos/table-layout')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    テーブルレイアウト
                  </button>
                  <button
                    onClick={() => router.push('/pos/reservations')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    予約受付
                  </button>
                  <button
                    onClick={() => router.push('/pos/handy')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    ハンディ注文
                  </button>
                  <button
                    onClick={() => router.push('/pos/register-closing')}
                    className="block w-full px-3.5 py-2 text-left text-[12.5px] hover:bg-secondary"
                  >
                    レジ締め
                  </button>
                  {me.authMode === 'pos_native' && (
                    <button
                      onClick={() => {
                        logoutPosStaff().finally(() => router.replace('/login'));
                      }}
                      className="block w-full border-t border-border px-3.5 py-2 text-left text-[12.5px] text-destructive hover:bg-secondary"
                    >
                      ログアウト
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {screen === 'tablemap' && (
        <TableMapScreen
          tableStatus={tableStatus}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onSelectTable={selectTable}
          layoutItems={layoutItems}
          tableSessions={tableSessions}
          tableActionMode={tableActionMode}
          moveSourceTable={moveSourceTable}
          mergeTargetTable={mergeTargetTable}
          mergeSourceTables={mergeSourceTables}
          tableActionBusy={tableActionBusy}
          tableActionError={tableActionError}
          onStartMove={startMoveMode}
          onStartMerge={startMergeMode}
          onCancelTableAction={cancelTableAction}
          onTableTapForAction={handleTableTapForAction}
          onConfirmMerge={confirmMerge}
        />
      )}

      {screen === 'order' && (
        <OrderScreen
          selectedTable={selectedTable}
          session={tableSessions.find((s) => s.table_code === selectedTable) ?? null}
          happyHourActive={happyHourActive}
          menu={menu}
          categories={categories}
          activeCategory={activeCategory}
          onCategory={setActiveCategory}
          cart={cart}
          confirmedItems={confirmedItems}
          onAddItem={onAddItem}
          onInc={incLine}
          onDec={decLine}
          onSetDiscount={setLineDiscount}
          onSetConfirmedItemDiscount={setConfirmedItemDiscount}
          onIncConfirmedItem={incConfirmedItemQty}
          onDecConfirmedItem={decConfirmedItemQty}
          onRemoveConfirmedItem={removeConfirmedItem}
          onConfirmOrder={confirmPendingCart}
          confirming={confirming}
          confirmError={confirmError}
          subtotal={totals.subtotal}
          vat={totals.vat}
          service={totals.service}
          vatRate={settings.vatRate}
          serviceRate={settings.serviceRate}
          vatInclusive={settings.vatInclusive}
          total={totals.total}
          menuImageStyle={settings.menuImageStyle}
          onBackToTableMap={() => setScreen('tablemap')}
          onCheckout={handleCheckout}
          onResetTable={resetCurrentTable}
        />
      )}

      {screen === 'checkout' && (
        <CheckoutScreen
          selectedTable={selectedTable}
          confirmedItems={confirmedItems}
          totals={totals}
          vatRate={settings.vatRate}
          serviceRate={settings.serviceRate}
          vatInclusive={settings.vatInclusive}
          couponApplied={couponApplied}
          customerLinked={customerLinked}
          onLinkCustomer={() => setCustomerLinked(true)}
          onApplyCoupon={() => setCouponApplied(true)}
          orderDiscount={orderDiscount}
          onSetOrderDiscount={setOrderDiscount}
          paymentLines={paymentLines}
          onAddPaymentLine={addPaymentLine}
          onRemovePaymentLine={removePaymentLine}
          paymentMethods={paymentMethods}
          khrRate={settings.khrRate}
          onBackToOrder={() => setScreen('order')}
          onComplete={completeOrder}
          completing={completing}
          completeError={completeError}
        />
      )}

      {screen === 'receipt' && (
        <ReceiptScreen
          selectedTable={selectedTable}
          total={receiptTotal}
          onNewOrder={newOrder}
          onReprintReceipt={reprintReceipt}
          reprintBusy={reprintBusy}
          canIssueInvoice={Boolean(lastCompletedOrder)}
          onIssueInvoice={issueInvoice}
          invoiceBusy={invoiceBusy}
          invoiceError={invoiceError}
          invoiceIssued={invoiceIssued}
        />
      )}

      {guestModalOpen && (
        <GuestDemographicsModal
          onCancel={handleGuestCancel}
          onConfirm={handleGuestConfirm}
          submitting={guestSaving}
          error={guestError}
        />
      )}

      {optionModalItem && (
        <OptionModal
          item={optionModalItem}
          selection={optionSelection}
          onSelect={(groupKey, choiceId) => setOptionSelection((prev) => ({ ...prev, [groupKey]: choiceId }))}
          onClose={() => {
            setOptionModalItem(null);
            setOptionSelection({});
          }}
          onConfirm={confirmOptionModal}
        />
      )}
    </div>
  );
}
