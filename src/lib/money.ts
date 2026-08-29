export function money(n: number): string {
  return n.toFixed(2);
}

/** USD/KHR混在の受け取り金額から、お釣りを USD(紙幣単位) + KHR(100riel単位) に分解する。
 *  会計画面 (CheckoutScreen) とレジ締め画面の両方でこのロジックを共有する。
 */
export function computeChange(params: {
  total: number;
  usdReceived: number;
  khrReceived: number;
  khrRate: number;
  /** ドル部分のお釣りをスタッフが手動で増減させた場合の値 (未指定なら最大値=お釣り総額の切り捨て) */
  changeUsdOverride?: number;
}) {
  const { total, usdReceived, khrReceived, khrRate, changeUsdOverride } = params;
  const totalReceivedUsdEquiv = usdReceived + khrReceived / khrRate;
  const rawChange = totalReceivedUsdEquiv - total;
  const maxChangeUsd = Math.max(0, Math.floor(rawChange + 1e-9));
  const changeUsd = Math.max(0, Math.min(changeUsdOverride ?? maxChangeUsd, maxChangeUsd));
  const changeKhr = Math.max(0, Math.round(((rawChange - changeUsd) * khrRate) / 100) * 100);
  const ok = total > 0 && totalReceivedUsdEquiv >= total - 0.005;

  return { totalReceivedUsdEquiv, rawChange, maxChangeUsd, changeUsd, changeKhr, ok };
}
