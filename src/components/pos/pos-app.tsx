'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CartLine, DiscountType, GuestEthnicity, MenuItem, PaymentMethod, TableStatus } from '@/lib/pos-types';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';
import { getPosMenus, getPosSettings, PosApiError } from '@/lib/api-client';
import {
  getPosOrderMenu,
  getPosOrderMode,
  getPosOrderSettings,
  getPosOrderTableLayout,
  PosOrderApiError,
} from '@/lib/pos-order-client';
import {
  completeOrderPayment,
  confirmOrderItems,
  createOpenOrder,
  getOpenOrder,
  updateConfirmedItemDiscount,
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
import { computeChange } from '@/lib/money';
import { logoutPosStaff } from '@/lib/staff-client';
import { useStaff } from './staff-context';
import { TableMapScreen } from './table-map-screen';
import { OrderScreen } from './order-screen';
import { CheckoutScreen } from './checkout-screen';
import { ReceiptScreen } from './receipt-screen';
import { OptionModal, type ModalSelection } from './option-modal';
import { GuestDemographicsModal } from './guest-demographics-modal';

type Screen = 'tablemap' | 'order' | 'checkout' | 'receipt';

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
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerLinked, setCustomerLinked] = useState(false);
  const [couponApplied, setCouponApplied] = useState(false);
  // 会計画面の合計から直接かける急遽の値引き (%引き・$引き)。ラインごとの値引きとは別枠で、
  // 顧客紐付け不要 (2026-08-31 追加。「合計の会計から割引ができるようにもしてほしい」)。
  const [orderDiscount, setOrderDiscount] = useState<{ type: DiscountType; value: number } | null>(null);
  const [paymentTab, setPaymentTab] = useState<PaymentMethod>('cash');
  const [cashUsdReceivedStr, setCashUsdReceivedStr] = useState('');
  const [cashKhrReceivedStr, setCashKhrReceivedStr] = useState('');
  const [changeUsdStr, setChangeUsdStr] = useState('');
  const [qrConfirmed, setQrConfirmed] = useState(false);
  const [cardConfirmed, setCardConfirmed] = useState(false);
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
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [pendingTapItem, setPendingTapItem] = useState<MenuItem | null>(null);
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
        if (menuSource === 'pos_native') {
          const [menuData, settingsData, layoutData, sessionsData] = await Promise.all([
            getPosOrderMenu(),
            getPosOrderSettings(),
            layoutPromise,
            sessionsPromise,
          ]);
          if (cancelled) return;
          setMenu(menuData.items);
          setPosNativeCategoryOrder(menuData.categories);
          setSettings((prev) => ({ ...prev, ...settingsData }));
          setLayoutItems(layoutData.items);
          setTableSessions(sessionsData.items);
        } else {
          const [menuData, settingsData, layoutData, sessionsData] = await Promise.all([
            getPosMenus(),
            getPosSettings(),
            layoutPromise,
            sessionsPromise,
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
    const couponDiscount = couponApplied ? Math.min(5, subtotal) : 0;
    // 会計画面の合計からの急遽の値引き。ライン値引き・クーポンとは独立に、subtotal を基準に
    // 計算する (％引きなら subtotal に対する割合、＄引きなら subtotal を上限とするドル額)。
    const orderDiscountAmount = discountAmount(subtotal, orderDiscount?.type, orderDiscount?.value);
    const total = settings.vatInclusive
      ? Math.max(0, subtotal + service - couponDiscount - orderDiscountAmount)
      : Math.max(0, subtotal + vat + service - couponDiscount - orderDiscountAmount);
    return { subtotal, vat, service, couponDiscount, orderDiscount: orderDiscountAmount, total };
  }, [cart, confirmedItems, couponApplied, orderDiscount, settings.vatRate, settings.vatInclusive, settings.serviceRate]);

  function resetOrderState() {
    setCustomerLinked(false);
    setCouponApplied(false);
    setOrderDiscount(null);
    setPaymentTab('cash');
    setCashUsdReceivedStr('');
    setCashKhrReceivedStr('');
    setChangeUsdStr('');
    setQrConfirmed(false);
    setCardConfirmed(false);
    setOptionModalItem(null);
    setOptionSelection({});
    setGuestModalOpen(false);
    setPendingTapItem(null);
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

  // この卓でまだ open 注文が無ければ (=ファースト注文) 客層記録モーダルを先に挟む。
  // タップした商品は pendingTapItem に覚えておき、モーダル保存後に自動で追加する。
  function onAddItem(item: MenuItem) {
    if (!currentOrder) {
      setPendingTapItem(item);
      setGuestError(null);
      setGuestModalOpen(true);
      return;
    }
    proceedAddItem(item);
  }

  async function handleGuestConfirm(ethnicity: GuestEthnicity, kidsCount: number) {
    if (!selectedTable) return;
    setGuestSaving(true);
    setGuestError(null);
    try {
      const { order } = await createOpenOrder({
        tableCode: selectedTable,
        guestEthnicity: ethnicity,
        guestKidsCount: kidsCount,
        staffId: me.id,
      });
      setCurrentOrder(order);
      setGuestModalOpen(false);
      const item = pendingTapItem;
      setPendingTapItem(null);
      if (item) proceedAddItem(item);
    } catch (err) {
      setGuestError(err instanceof PosOrderOrdersApiError ? err.message : '客層の保存に失敗しました');
    } finally {
      setGuestSaving(false);
    }
  }

  function handleGuestCancel() {
    setGuestModalOpen(false);
    setPendingTapItem(null);
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
  async function handleCheckout() {
    if (cart.length === 0 && confirmedItems.length === 0) return;
    const ok = await confirmPendingCart();
    if (!ok) return;
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

  async function completeOrder() {
    if (!currentOrder || completing) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const usdReceived = parseFloat(cashUsdReceivedStr) || 0;
      const khrReceived = parseInt(cashKhrReceivedStr, 10) || 0;
      const change = computeChange({
        total: totals.total,
        usdReceived,
        khrReceived,
        khrRate: settings.khrRate,
        changeUsdOverride: changeUsdStr === '' ? undefined : parseInt(changeUsdStr, 10) || 0,
      });
      await completeOrderPayment(currentOrder.id, {
        subtotal: totals.subtotal,
        vat: totals.vat,
        service: totals.service,
        couponDiscount: totals.couponDiscount,
        orderDiscount: totals.orderDiscount,
        total: totals.total,
        method: paymentTab,
        amount: totals.total,
        cashReceivedUsd: paymentTab === 'cash' ? usdReceived : undefined,
        cashReceivedKhr: paymentTab === 'cash' ? khrReceived : undefined,
        changeUsd: paymentTab === 'cash' ? change.changeUsd : undefined,
        changeKhr: paymentTab === 'cash' ? change.changeKhr : undefined,
      });
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
          onBackToTableMap={() => setScreen('tablemap')}
          onCheckout={handleCheckout}
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
          paymentTab={paymentTab}
          onPaymentTab={setPaymentTab}
          cashUsdReceivedStr={cashUsdReceivedStr}
          cashKhrReceivedStr={cashKhrReceivedStr}
          onUsdReceivedChange={(v) => {
            setCashUsdReceivedStr(v);
            setChangeUsdStr('');
          }}
          onKhrReceivedChange={(v) => {
            setCashKhrReceivedStr(v);
            setChangeUsdStr('');
          }}
          changeUsdStr={changeUsdStr}
          onChangeUsdInc={() => setChangeUsdStr((v) => String((parseInt(v, 10) || 0) + 1))}
          onChangeUsdDec={() => setChangeUsdStr((v) => String(Math.max(0, (parseInt(v, 10) || 0) - 1)))}
          khrRate={settings.khrRate}
          qrConfirmed={qrConfirmed}
          onConfirmQr={() => setQrConfirmed(true)}
          cardConfirmed={cardConfirmed}
          onConfirmCard={() => setCardConfirmed(true)}
          onBackToOrder={() => setScreen('order')}
          onComplete={completeOrder}
          completing={completing}
          completeError={completeError}
        />
      )}

      {screen === 'receipt' && (
        <ReceiptScreen selectedTable={selectedTable} total={receiptTotal} onNewOrder={newOrder} />
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
