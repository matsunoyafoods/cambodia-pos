/**
 * 給料明細 (Payslip) の印刷用HTML生成 (2026-11-02 追加)。
 *
 * Tom「給料計算のところに給料明細をダウンロードできるようにして欲しい。欲しい情報と型に
 * 関しては添付しています」への対応。添付されたフォーマット (I'm Hungry454 のロゴ付き・
 * 英語/クメール語併記の請求書スタイル) をそのまま再現する。
 *
 * 実装方針: 専用のPDFライブラリは追加せず、既存の経費レポート等と同じ「ブラウザの印刷機能
 * (PDFとして保存)」方式を使う。ただしこの明細は1人分だけの独立した書類であり、他の画面の
 * 内容と一緒に印刷されては困るため、別ウィンドウに完全に独立したHTMLドキュメントを書き出して
 * そこで window.print() する方式にした (他画面の print:hidden ルールと干渉しない)。
 *
 * フィールド対応 (Tom確認済み。2026-11-02): 添付フォーマットの3つの控除欄は、システムが
 * 既に計算している値の組み合わせで表現する (合計すると必ず totalDeduction と一致する):
 * - Leave Deduction   = absenceDeduction (欠勤控除)
 * - Penalty           = latenessDeduction + earlyLeaveDeduction (遅刻+早退控除)
 * - Dormitory Fee     = fixedDeductionTotal + otherDeduction (固定控除 + その他控除。
 *                        多くの場合これが寮費そのものだが、他の固定/単発控除があれば
 *                        ここにまとめて含まれる)
 *
 * クメール語の見出し文言は添付画像からの書き写し (Tom確認済み「画像の通りで大丈夫」)。
 * ただし画像からの判読には限界があるため、文字化け・誤字があれば教えてもらえれば
 * すぐ直せるよう、文言はこのファイル冒頭の定数にまとめてある。
 */

const MONTH_NAMES_EN = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

// 見出し文言 (クメール語/英語併記)。ここを直せば表示文言が全体に反映される。
const LABELS = {
  invoiceTitle: 'Invoice',
  workingDays: 'ចំនួនថ្ងៃធ្វើការ/Working Days',
  baseSalary: 'ប្រាក់ខែគូល/Base Salary',
  totalWorkingHours: 'ម៉ោងធ្វើការសរុប/Total Working Hours',
  allowance: 'ប្រាក់បន្ថែម/Allowance',
  leaveDeduction: 'កាត់ប្រាក់ឈប់សម្រាក/Leave Deduction',
  penalty: 'ពិន័យ/Penalty',
  dormitoryFee: 'ថ្លៃផ្ទះសំណាក់/Dormitory Fee',
  totalEarningsEn: 'Total Earnings',
  totalEarningsKm: 'ប្រាក់ចំណូលសរុប',
  totalDeductionsEn: 'Total Deductions',
  totalDeductionsKm: 'ប្រាក់បានកាត់សរុប',
  netPayEn: 'Net Pay :',
  netPayKm: 'ប្រាក់ខែទទួលបានសរុប',
  billedTo: 'Billed To :',
  thankYouEn1: 'Thank you',
  thankYouEn2: 'for your working!',
  thankYouKm: 'អរគុណសម្រាប់ការខិតខំធ្វើការ',
  thankYouJa: 'お疲れ様でした',
};

export type PayslipCalcInput = {
  normalWorkDays: number;
  workedHours: number;
  grossPay: number;
  totalAllowance: number;
  absenceDeduction: number;
  latenessDeduction: number;
  earlyLeaveDeduction: number;
  fixedDeductionTotal: number;
  otherDeduction: number;
  totalDeduction: number;
  finalPay: number;
};

export type BuildPayslipHtmlInput = {
  staffName: string;
  yearMonth: string; // 'YYYY-MM'
  calc: PayslipCalcInput;
  /** 設定画面の領収書ヘッダー文言 (店名・住所・電話番号等)。1行ずつ表示する。 */
  storeHeaderLines: string[];
  /** 設定画面でアップロード済みのレシート用ロゴ (base64 PNG)。未設定ならロゴなしで表示。 */
  logoBase64: string | null;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${hh}:${String(mm).padStart(2, '0')}`;
}

function monthLabel(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const name = MONTH_NAMES_EN[m - 1] ?? mStr;
  return `${name}/${y}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildPayslipHtml(input: BuildPayslipHtmlInput): string {
  const c = input.calc;
  const penalty = c.latenessDeduction + c.earlyLeaveDeduction;
  const dormitoryFee = c.fixedDeductionTotal + c.otherDeduction;
  const totalEarnings = c.grossPay + c.totalAllowance;

  const logoBlock = input.logoBase64
    ? `<img src="data:image/png;base64,${input.logoBase64}" alt="logo" class="logo" />`
    : `<div class="logo-fallback">${escapeHtml(input.storeHeaderLines[0] ?? '')}</div>`;

  const headerLinesHtml = input.storeHeaderLines
    .map((line, i) => `<div class="${i === 0 ? 'store-name' : 'store-line'}">${escapeHtml(line)}</div>`)
    .join('');

  const allowanceRow =
    c.totalAllowance > 0
      ? `
      <div class="row-3">
        <div class="cell">
          <div class="cell-label">${LABELS.allowance}</div>
          <div class="cell-value">${money(c.totalAllowance)}</div>
        </div>
        <div class="cell">
          <div class="cell-label">${LABELS.leaveDeduction}</div>
          <div class="cell-value deduction">${money(c.absenceDeduction)}</div>
        </div>
        <div class="cell">
          <div class="cell-label">${LABELS.penalty}</div>
          <div class="cell-value deduction">${money(penalty)}</div>
        </div>
      </div>
      <div class="row-1">
        <div class="cell">
          <div class="cell-label">${LABELS.dormitoryFee}</div>
          <div class="cell-value deduction">${money(dormitoryFee)}</div>
        </div>
      </div>`
      : `
      <div class="row-3">
        <div class="cell">
          <div class="cell-label">${LABELS.leaveDeduction}</div>
          <div class="cell-value deduction">${money(c.absenceDeduction)}</div>
        </div>
        <div class="cell">
          <div class="cell-label">${LABELS.penalty}</div>
          <div class="cell-value deduction">${money(penalty)}</div>
        </div>
        <div class="cell">
          <div class="cell-label">${LABELS.dormitoryFee}</div>
          <div class="cell-value deduction">${money(dormitoryFee)}</div>
        </div>
      </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.staffName)} - ${escapeHtml(monthLabel(input.yearMonth))}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px;
    background: #fff;
    color: #1a1a1a;
    font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Khmer OS", "Noto Sans Khmer", Arial, sans-serif;
  }
  .sheet { max-width: 720px; margin: 0 auto; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; }
  .logo { height: 72px; }
  .logo-fallback { font-size: 22px; font-weight: 800; }
  .invoice-title { font-size: 48px; font-weight: 800; letter-spacing: 1px; }
  .store-block { text-align: right; margin-bottom: 28px; font-size: 12px; color: #333; }
  .store-name { font-weight: 800; font-size: 14px; margin-bottom: 4px; }
  .store-line { line-height: 1.5; }
  .meta { margin-bottom: 18px; }
  .meta-month { font-weight: 800; font-size: 14px; letter-spacing: 0.5px; }
  .meta-billed { font-size: 14px; margin-top: 4px; }
  .meta-billed .name { font-weight: 800; font-size: 20px; margin-left: 8px; }
  .pink-band {
    background: #f6c9dc;
    border-radius: 6px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 700;
    font-size: 13px;
    margin-bottom: 2px;
  }
  .pink-band .value { font-size: 18px; font-weight: 800; }
  .row-3 { display: flex; }
  .row-1 { display: flex; }
  .cell {
    flex: 1;
    border: 1px solid #ddd;
    padding: 10px 14px;
  }
  .row-3 .cell:nth-child(odd) { background: #f3f3f3; }
  .cell-label { font-size: 11px; color: #444; margin-bottom: 6px; }
  .cell-value { font-size: 16px; font-weight: 700; text-align: right; }
  .cell-value.deduction { color: #c0392b; }
  .summary { display: flex; justify-content: flex-end; margin-top: 24px; }
  .summary-table { width: 300px; }
  .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
  .summary-row .label-en { font-weight: 600; }
  .summary-row .label-km { font-size: 10.5px; color: #777; }
  .summary-row .value { font-weight: 700; }
  .summary-row .value.deduction { color: #c0392b; }
  .net-pay {
    margin-top: 10px;
    background: #f6c9dc;
    border-radius: 6px;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .net-pay .label-en { font-weight: 800; font-size: 13px; }
  .net-pay .label-km { font-size: 10.5px; color: #555; }
  .net-pay .value { font-weight: 800; font-size: 20px; }
  .footer { margin-top: 48px; text-align: center; }
  .footer .en { font-size: 18px; font-weight: 800; line-height: 1.4; }
  .footer .km { font-size: 13px; margin-top: 6px; }
  .footer .ja { font-size: 13px; margin-top: 4px; color: #444; }
  @media print {
    body { padding: 0; }
    .sheet { max-width: none; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      ${logoBlock}
      <div class="invoice-title">${LABELS.invoiceTitle}</div>
    </div>
    <div class="store-block">
      ${headerLinesHtml}
    </div>
    <div class="meta">
      <div class="meta-month">${escapeHtml(monthLabel(input.yearMonth))}</div>
      <div class="meta-billed">${LABELS.billedTo}<span class="name">${escapeHtml(input.staffName)}</span></div>
    </div>

    <div class="pink-band">
      <span>${LABELS.workingDays}</span>
      <span class="value">${c.normalWorkDays}</span>
    </div>

    <div class="row-3" style="margin-top: 2px;">
      <div class="cell" style="background:#f3f3f3;">
        <div class="cell-label">${LABELS.baseSalary}</div>
        <div class="cell-value">${money(c.grossPay)}</div>
      </div>
      <div class="cell">
        <div class="cell-label">${LABELS.totalWorkingHours}</div>
        <div class="cell-value">${formatHoursMinutes(c.workedHours)}</div>
      </div>
    </div>
    ${allowanceRow}

    <div class="summary">
      <div class="summary-table">
        <div class="summary-row">
          <div><div class="label-en">${LABELS.totalEarningsEn}</div><div class="label-km">${LABELS.totalEarningsKm}</div></div>
          <div class="value">${money(totalEarnings)}</div>
        </div>
        <div class="summary-row">
          <div><div class="label-en">${LABELS.totalDeductionsEn}</div><div class="label-km">${LABELS.totalDeductionsKm}</div></div>
          <div class="value deduction">${money(c.totalDeduction)}</div>
        </div>
        <div class="net-pay">
          <div><div class="label-en">${LABELS.netPayEn}</div><div class="label-km">${LABELS.netPayKm}</div></div>
          <div class="value">${money(c.finalPay)}</div>
        </div>
      </div>
    </div>

    <div class="footer">
      <div class="en">${LABELS.thankYouEn1}<br/>${LABELS.thankYouEn2}</div>
      <div class="km">${LABELS.thankYouKm}</div>
      <div class="ja">${LABELS.thankYouJa}</div>
    </div>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 150);
    });
  </script>
</body>
</html>`;
}
