import type { CartLine, DiscountType } from './pos-types';

// カートの1ラインに対する急遽の値引き計算。値引きはライン単位 (unitPrice × qty の合計) に
// 対して適用する (1個あたりではない)。'percent' は割引率、'fixed' はこのラインの合計額から
// 引くドル額 (ライン合計を超える値引きは指定できても、実際の値引き額はライン合計が上限)。
// 2026-08-31: Tomさんの要望で追加 (「急遽この商品だけ20%OFFにしたり$1割引したり」)。

export function cartLineGrossTotal(line: Pick<CartLine, 'unitPrice' | 'qty'>): number {
  return line.unitPrice * line.qty;
}

export function cartLineDiscountAmount(line: Pick<CartLine, 'unitPrice' | 'qty' | 'discountType' | 'discountValue'>): number {
  if (!line.discountType || !line.discountValue || line.discountValue <= 0) return 0;
  const gross = cartLineGrossTotal(line);
  if (line.discountType === 'percent') {
    const pct = Math.min(100, line.discountValue);
    return gross * (pct / 100);
  }
  return Math.min(gross, line.discountValue);
}

export function cartLineNetTotal(line: Pick<CartLine, 'unitPrice' | 'qty' | 'discountType' | 'discountValue'>): number {
  return Math.max(0, cartLineGrossTotal(line) - cartLineDiscountAmount(line));
}

// カートに送信する品目名に付ける値引きラベル (厨房伝票・会計画面・DBの menu_name に
// そのまま残るので、後から見てもどのラインに値引きが入ったか分かるようにする)。
export function cartLineDiscountLabel(line: Pick<CartLine, 'discountType' | 'discountValue'>): string | null {
  if (!line.discountType || !line.discountValue || line.discountValue <= 0) return null;
  return line.discountType === 'percent' ? `${line.discountValue}%OFF` : `-$${line.discountValue.toFixed(2)}`;
}

// ---- 汎用の値引き計算 (確定済み注文品目・会計全体 (合計からの値引き) にも同じ考え方で使う) ----
// 2026-08-31 追加: 「注文確定」後の品目にも値引き編集できるようにしたい、会計画面の合計からも
// 値引きできるようにしたい、という要望に対応。カート未確定ラインの計算式 (上記) と揃えてある。

export function discountAmount(gross: number, type?: DiscountType, value?: number): number {
  if (!type || !value || value <= 0) return 0;
  if (type === 'percent') {
    const pct = Math.min(100, value);
    return gross * (pct / 100);
  }
  return Math.min(gross, value);
}

export function discountLabel(type?: DiscountType, value?: number): string | null {
  if (!type || !value || value <= 0) return null;
  return type === 'percent' ? `${value}%OFF` : `-$${value.toFixed(2)}`;
}

// 確定済み品目の menu_name には「元の商品名 [20%OFF]」のように値引きラベルが末尾の
// 角括弧で付いていることがある (confirmOrderItems で付与)。値引きを設定し直す時は、まず
// 元の商品名を復元してから (stripDiscountLabel)、新しいラベルを付け直す。
export function stripDiscountLabel(menuName: string): string {
  return menuName.replace(/\s*\[[^[\]]*\]\s*$/, '');
}

// menu_name の末尾角括弧ラベルから、現在適用中の値引き種別・値を復元する
// (確定済み品目の編集フォームに現在値を表示するため)。ラベル形式と一致しない場合は null。
export function parseOrderItemDiscount(menuName: string): { type: DiscountType; value: number } | null {
  const m = menuName.match(/\[([^[\]]*)\]\s*$/);
  if (!m) return null;
  const label = m[1];
  const pctMatch = label.match(/^(\d+(?:\.\d+)?)%OFF$/);
  if (pctMatch) return { type: 'percent', value: parseFloat(pctMatch[1]) };
  const fixedMatch = label.match(/^-\$(\d+(?:\.\d+)?)$/);
  if (fixedMatch) return { type: 'fixed', value: parseFloat(fixedMatch[1]) };
  return null;
}
