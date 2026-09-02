/**
 * 経費・勤怠レポートのCSV出力 (2026-09-01 追加)。サーバー側に新しいエンドポイントは作らず、
 * クライアント側で Blob を作ってダウンロードさせるだけの軽量な実装 (PDF出力の考え方と同じく、
 * サーバー処理・新規ライブラリを増やさない)。
 */

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  // Excelで日本語が文字化けしないよう UTF-8 BOM を先頭に付与する。
  const bom = '﻿';
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(','));
  const csv = bom + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
