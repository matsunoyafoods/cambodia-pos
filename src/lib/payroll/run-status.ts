/**
 * 月次給与のステータス管理 (2026-09-04 追加)。
 * Tom仕様: 編集中(draft) → 確認待ち(pending_review) → 確定済み(confirmed) の3段階。
 * 確定済みは通常の操作では変更できない (修正するには理由付きの修正履歴を残す別経路が必要)。
 */

export type PayrollRunStatus = 'draft' | 'pending_review' | 'confirmed';

/** 通常の編集操作 (再計算・保存) が許可されるか。確定済みのみ不可。 */
export function canEditDirectly(status: PayrollRunStatus): boolean {
  return status !== 'confirmed';
}

/** 確定操作 (draft/pending_review → confirmed) が許可されるか。 */
export function canConfirm(status: PayrollRunStatus): boolean {
  return status === 'draft' || status === 'pending_review';
}

/** 確定済みの給与を修正する (修正履歴を残す) ことが許可されるステータスか。 */
export function canAmend(status: PayrollRunStatus): boolean {
  return status === 'confirmed';
}
