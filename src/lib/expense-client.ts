/**
 * 経費管理 (仕入れ・雑費・買掛管理) の同一オリジン API クライアント。
 * (2026-08-31 追加。データ収集・AI分析機能 第一弾)
 *
 * - 仕入れ先 (expense_vendors) / 費目 (expense_categories) はマスタ一覧。owner/manager が管理し、
 *   実際の経費記録 (expenses.vendor / expenses.category) はスナップショットの自由入力文字列として
 *   保存する (マスタを後から改名・削除しても過去の記録は変わらない方針。payment-methods / handy
 *   グループと同じ設計)。
 * - staff は経費の新規登録のみ可能 (現場で立て替えたらすぐ記録できるように)。一覧・編集・削除・
 *   マスタ管理は manager 以上のみ。
 */

import type { ExpenseCategory, ExpensePaidFrom, ExpensePaymentStatus, ExpenseRecord, ExpenseVendor } from '@/lib/pos-types';

export class PosExpenseApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PosExpenseApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore JSON parse failure
    }
    throw new PosExpenseApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

// ---------- 仕入れ先マスタ ----------

export async function listExpenseVendors(): Promise<ExpenseVendor[]> {
  const { vendors } = await request<{ vendors: ExpenseVendor[] }>('/api/settings/expense-vendors');
  return vendors;
}

export async function createExpenseVendor(name: string): Promise<ExpenseVendor> {
  const { vendor } = await request<{ vendor: ExpenseVendor }>('/api/settings/expense-vendors', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return vendor;
}

export async function updateExpenseVendor(id: string, patch: { name?: string; sortOrder?: number }): Promise<ExpenseVendor> {
  const { vendor } = await request<{ vendor: ExpenseVendor }>(`/api/settings/expense-vendors/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return vendor;
}

export async function deleteExpenseVendor(id: string): Promise<void> {
  await request(`/api/settings/expense-vendors/${id}`, { method: 'DELETE' });
}

// ---------- 費目マスタ ----------

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const { categories } = await request<{ categories: ExpenseCategory[] }>('/api/settings/expense-categories');
  return categories;
}

export async function createExpenseCategory(name: string): Promise<ExpenseCategory> {
  const { category } = await request<{ category: ExpenseCategory }>('/api/settings/expense-categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return category;
}

export async function updateExpenseCategory(id: string, patch: { name?: string; sortOrder?: number }): Promise<ExpenseCategory> {
  const { category } = await request<{ category: ExpenseCategory }>(`/api/settings/expense-categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return category;
}

export async function deleteExpenseCategory(id: string): Promise<void> {
  await request(`/api/settings/expense-categories/${id}`, { method: 'DELETE' });
}

// ---------- 経費記録 ----------

export type CreateExpenseInput = {
  date: string; // YYYY-MM-DD
  amountUsd: number;
  category: string;
  vendor?: string;
  note?: string;
  paymentStatus?: ExpensePaymentStatus; // 未指定なら 'paid' (API 側デフォルト)
  /** 支払い元 (2026-09-02 追加)。未指定なら 'other' (API側デフォルト。現金残高からは引かれない) */
  paidFrom?: ExpensePaidFrom;
};

export async function createExpense(input: CreateExpenseInput): Promise<ExpenseRecord> {
  const { expense } = await request<{ expense: ExpenseRecord }>('/api/expenses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return expense;
}

export async function listExpenses(filter?: { from?: string; to?: string; status?: ExpensePaymentStatus }): Promise<ExpenseRecord[]> {
  const params = new URLSearchParams();
  if (filter?.from) params.set('from', filter.from);
  if (filter?.to) params.set('to', filter.to);
  if (filter?.status) params.set('status', filter.status);
  const qs = params.toString();
  const { expenses } = await request<{ expenses: ExpenseRecord[] }>(`/api/expenses${qs ? `?${qs}` : ''}`);
  return expenses;
}

export type UpdateExpenseInput = Partial<{
  date: string;
  amountUsd: number;
  category: string;
  vendor: string | null;
  note: string | null;
  paymentStatus: ExpensePaymentStatus;
  paidFrom: ExpensePaidFrom;
}>;

export async function updateExpense(id: string, patch: UpdateExpenseInput): Promise<ExpenseRecord> {
  const { expense } = await request<{ expense: ExpenseRecord }>(`/api/expenses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return expense;
}

// 買掛の決済 (未払い → 支払い済みにする)。updateExpense の薄いラッパー。
// 精算した瞬間に初めて現金 (または他の方法) が動くため、paidFrom もここで確定させる
// (2026-09-02 追加。現金残高計算のため — レジの現金で精算した買掛も残高から引く)。
export function settleExpense(id: string, paidFrom: ExpensePaidFrom): Promise<ExpenseRecord> {
  return updateExpense(id, { paymentStatus: 'paid', paidFrom });
}

export async function deleteExpense(id: string): Promise<void> {
  await request(`/api/expenses/${id}`, { method: 'DELETE' });
}

// ---------- レシート写真 (2026-09-01 追加) ----------
// JSONではなく multipart/form-data で送るため、共通 request() は使わずここだけ個別に fetch する。

export async function uploadExpenseReceipt(expenseId: string, file: File): Promise<{ receiptImageUrl: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/expenses/${expenseId}/receipt`, { method: 'POST', body: form });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new PosExpenseApiError(message, res.status);
  }
  return res.json() as Promise<{ receiptImageUrl: string }>;
}

export async function deleteExpenseReceipt(expenseId: string): Promise<void> {
  await request(`/api/expenses/${expenseId}/receipt`, { method: 'DELETE' });
}
