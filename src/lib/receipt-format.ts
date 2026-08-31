/**
 * 感熱プリンター (58mm/80mm) 向けの領収書・厨房伝票のテキスト整形。
 * ローカル印刷エージェント (print-agent) はこのテキストをそのまま (等幅フォントの)
 * ESC/POS 印刷データとして送る (2026-08-31 プリンター実装で追加)。
 */

import { money } from './money';

/** 用紙幅(mm)から、標準的な英数フォントでの1行の桁数を概算する。58mm≒32桁、80mm≒46桁。 */
export function columnsForPaperWidth(paperWidthMm: number): number {
  return paperWidthMm >= 70 ? 46 : 32;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

function line(char: string, width: number): string {
  return char.repeat(width);
}

/** 左詰めラベルと右詰め金額を1行に収める。ラベルが長い場合は折り返す。 */
function labelValueLine(label: string, value: string, width: number): string {
  const gap = width - label.length - value.length;
  if (gap >= 1) return label + ' '.repeat(gap) + value;
  // ラベルが長すぎる場合は2行に分ける
  return label + '\n' + ' '.repeat(Math.max(0, width - value.length)) + value;
}

function centerText(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  const totalPad = width - s.length;
  const left = Math.floor(totalPad / 2);
  return ' '.repeat(left) + s;
}

export type ReceiptItemLine = { name: string; qty: number; lineTotal: number };
export type ReceiptPaymentLine = { method: 'cash' | 'qr' | 'card'; amount: number };

const METHOD_LABEL: Record<ReceiptPaymentLine['method'], string> = { cash: '現金', qr: 'QR', card: 'カード' };

export function formatReceiptText(params: {
  storeName: string;
  tableCode: string | null;
  items: ReceiptItemLine[];
  subtotal: number;
  vat: number;
  vatRate: number;
  vatInclusive: boolean;
  service: number;
  serviceRate: number;
  couponDiscount: number;
  orderDiscount: number;
  total: number;
  payments: ReceiptPaymentLine[];
  paperWidthMm: number;
  paidAt: Date;
}): string {
  const w = columnsForPaperWidth(params.paperWidthMm);
  const rows: string[] = [];
  rows.push(centerText(params.storeName, w));
  rows.push(centerText('お会計レシート', w));
  rows.push(line('-', w));
  if (params.tableCode) rows.push(`テーブル: ${params.tableCode}`);
  rows.push(
    params.paidAt.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  );
  rows.push(line('-', w));
  for (const it of params.items) {
    rows.push(`${it.name} x${it.qty}`);
    rows.push(labelValueLine('', `$${money(it.lineTotal)}`, w));
  }
  rows.push(line('-', w));
  rows.push(labelValueLine('小計', `$${money(params.subtotal)}`, w));
  if (params.vatRate > 0) {
    rows.push(labelValueLine(`VAT ${params.vatRate}%${params.vatInclusive ? '(税込)' : ''}`, `$${money(params.vat)}`, w));
  }
  if (params.serviceRate > 0) {
    rows.push(labelValueLine(`サービス料 ${params.serviceRate}%`, `$${money(params.service)}`, w));
  }
  if (params.couponDiscount > 0) rows.push(labelValueLine('クーポン割引', `-$${money(params.couponDiscount)}`, w));
  if (params.orderDiscount > 0) rows.push(labelValueLine('割引', `-$${money(params.orderDiscount)}`, w));
  rows.push(line('=', w));
  rows.push(labelValueLine('合計', `$${money(params.total)}`, w));
  rows.push(line('=', w));
  for (const p of params.payments) {
    rows.push(labelValueLine(METHOD_LABEL[p.method], `$${money(p.amount)}`, w));
  }
  rows.push('');
  rows.push(centerText('ありがとうございました', w));
  rows.push('');
  rows.push('');
  return rows.join('\n');
}

export function formatKitchenTicketText(params: {
  tableCode: string | null;
  items: { name: string; qty: number; optionsLabel?: string }[];
  paperWidthMm: number;
  confirmedAt: Date;
}): string {
  const w = columnsForPaperWidth(params.paperWidthMm);
  const rows: string[] = [];
  rows.push(centerText('厨房伝票', w));
  rows.push(line('=', w));
  if (params.tableCode) rows.push(`テーブル: ${padRight(params.tableCode, w - 9)}`);
  rows.push(
    params.confirmedAt.toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );
  rows.push(line('=', w));
  for (const it of params.items) {
    rows.push(`${it.name} x${it.qty}`);
    if (it.optionsLabel) rows.push(`  (${it.optionsLabel})`);
  }
  rows.push(line('-', w));
  rows.push('');
  rows.push('');
  return rows.join('\n');
}
