import type { CartLine } from './pos-types';

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
