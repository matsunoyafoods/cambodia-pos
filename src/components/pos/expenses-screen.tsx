'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  createExpense,
  createExpenseCategory,
  createExpenseVendor,
  deleteExpense,
  deleteExpenseCategory,
  deleteExpenseVendor,
  listExpenseCategories,
  listExpenseVendors,
  listExpenses,
  PosExpenseApiError,
  settleExpense,
  updateExpense,
} from '@/lib/expense-client';
import type { ExpenseCategory, ExpensePaymentStatus, ExpenseRecord, ExpenseVendor } from '@/lib/pos-types';

// 経費管理画面 (2026-08-31 追加)。
// 「経費はよく買うところなどは登録できるようにしましょう！経費は雑費や仕入れなどの項目も登録して
// 選べるようにしましょう！買掛もできるようにね。」への対応。
// - 上部: 誰でも使えるクイック入力フォーム (立て替え購入をその場で記録)
// - 下部: manager 以上限定のレポート (期間絞り込み・合計・編集・削除・買掛の精算) と
//   仕入れ先/費目マスタの管理

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function ExpensesScreen() {
  const router = useRouter();
  const me = useStaff();
  const canManage = me.role === 'owner' || me.role === 'manager';

  const [vendors, setVendors] = useState<ExpenseVendor[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [mastersError, setMastersError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadMasters = useCallback(() => {
    Promise.all([listExpenseVendors(), listExpenseCategories()])
      .then(([v, c]) => {
        setVendors(v);
        setCategories(c);
      })
      .catch((err) => setMastersError(err instanceof PosExpenseApiError ? err.message : 'マスタの取得に失敗しました'));
  }, []);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← レジ画面へ
        </button>
        <div className="text-[15px] font-bold">経費</div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[820px] flex-col gap-6">
          {mastersError && <div className="text-[12.5px] text-destructive">{mastersError}</div>}
          <QuickEntryForm
            vendors={vendors}
            categories={categories}
            onCreated={() => setRefreshKey((k) => k + 1)}
          />
          {canManage && (
            <>
              <ExpenseReport refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
              <MasterListsSection vendors={vendors} categories={categories} onChanged={loadMasters} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickEntryForm({
  vendors,
  categories,
  onCreated,
}: {
  vendors: ExpenseVendor[];
  categories: ExpenseCategory[];
  onCreated: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [categoryOther, setCategoryOther] = useState('');
  const [vendor, setVendor] = useState('');
  const [vendorOther, setVendorOther] = useState('');
  const [note, setNote] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<ExpensePaymentStatus>('paid');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const resolvedCategory = category === '__other__' ? categoryOther.trim() : category;
  const resolvedVendor = vendor === '__other__' ? vendorOther.trim() : vendor;
  const amountNum = Number(amount);
  const canSubmit = date && amountNum > 0 && resolvedCategory.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      await createExpense({
        date,
        amountUsd: amountNum,
        category: resolvedCategory,
        vendor: resolvedVendor || undefined,
        note: note.trim() || undefined,
        paymentStatus,
      });
      setAmount('');
      setNote('');
      setDone(true);
      onCreated();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 text-[13.5px] font-semibold">経費を記録する</div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2.5">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            日付
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            金額 (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-10 w-32 rounded-lg border border-border px-2.5 text-[13px]"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            費目
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-48 rounded-lg border border-border px-2.5 text-[13px]">
              <option value="">選択してください</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value="__other__">その他 (自由入力)</option>
            </select>
          </label>
          {category === '__other__' && (
            <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
              費目名
              <input value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} className="h-10 w-40 rounded-lg border border-border px-2.5 text-[13px]" />
            </label>
          )}

          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            仕入れ先・買い物先 (任意)
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-10 w-48 rounded-lg border border-border px-2.5 text-[13px]">
              <option value="">選択なし</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}
                </option>
              ))}
              <option value="__other__">その他 (自由入力)</option>
            </select>
          </label>
          {vendor === '__other__' && (
            <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
              仕入れ先名
              <input value={vendorOther} onChange={(e) => setVendorOther(e.target.value)} className="h-10 w-40 rounded-lg border border-border px-2.5 text-[13px]" />
            </label>
          )}
        </div>

        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ (任意)" className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="radio" checked={paymentStatus === 'paid'} onChange={() => setPaymentStatus('paid')} />
            支払い済み
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="radio" checked={paymentStatus === 'unpaid'} onChange={() => setPaymentStatus('unpaid')} />
            買掛 (未払い)
          </label>
        </div>

        {error && <div className="text-[12.5px] text-destructive">{error}</div>}
        {done && !error && <div className="text-[12.5px] text-emerald-600">登録しました。</div>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="h-11 w-fit rounded-lg bg-primary px-6 text-[13.5px] font-bold text-primary-foreground disabled:opacity-40"
        >
          {submitting ? '登録中…' : '記録する'}
        </button>
      </div>
    </div>
  );
}

function ExpenseReport({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [from, setFrom] = useState(() => todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState<'all' | ExpensePaymentStatus>('all');
  const [rows, setRows] = useState<ExpenseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listExpenses({ from, to, status: statusFilter === 'all' ? undefined : statusFilter })
      .then(setRows)
      .catch((err) => setError(err instanceof PosExpenseApiError ? err.message : '経費一覧の取得に失敗しました'));
  }, [from, to, statusFilter]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const total = useMemo(() => (rows ?? []).reduce((sum, r) => sum + r.amountUsd, 0), [rows]);
  const unpaidTotal = useMemo(() => (rows ?? []).filter((r) => r.paymentStatus === 'unpaid').reduce((sum, r) => sum + r.amountUsd, 0), [rows]);

  async function handleSettle(id: string) {
    try {
      await settleExpense(id);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '精算に失敗しました');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('この経費記録を削除しますか？')) return;
    try {
      await deleteExpense(id);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '削除に失敗しました');
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="text-[13.5px] font-semibold">経費レポート</div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <span className="text-[12px] text-muted-foreground">〜</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | ExpensePaymentStatus)} className="h-9 rounded-lg border border-border px-2 text-[12.5px]">
            <option value="all">すべて</option>
            <option value="paid">支払い済み</option>
            <option value="unpaid">買掛のみ</option>
          </select>
          <button onClick={load} className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold">
            更新
          </button>
        </div>
      </div>

      {rows && (
        <div className="mb-3 flex gap-5 rounded-lg bg-secondary/40 px-4 py-2.5 text-[12.5px]">
          <div>
            合計: <span className="font-semibold">${total.toFixed(2)}</span>
          </div>
          <div>
            うち買掛 (未払い): <span className="font-semibold text-amber-600">${unpaidTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {error && <div className="mb-2 text-[12.5px] text-destructive">{error}</div>}
      {!rows && <div className="text-[12.5px] text-muted-foreground">読み込み中…</div>}
      {rows?.length === 0 && <div className="text-[12.5px] text-muted-foreground">この条件の経費記録はありません。</div>}

      <div className="flex flex-col gap-2">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-lg border border-border px-3.5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px]">
                <span className="font-semibold">${r.amountUsd.toFixed(2)}</span>
                <span className="ml-2 text-muted-foreground">
                  {r.date} ・ {r.category}
                  {r.vendor && ` ・ ${r.vendor}`}
                </span>
                {r.paymentStatus === 'unpaid' ? (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">買掛</span>
                ) : (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">支払い済み</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {r.paymentStatus === 'unpaid' && (
                  <button onClick={() => handleSettle(r.id)} className="rounded-md border border-emerald-600 px-2 py-1 text-[11.5px] font-semibold text-emerald-700">
                    精算する
                  </button>
                )}
                <button onClick={() => setEditingId((v) => (v === r.id ? null : r.id))} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold">
                  編集
                </button>
                <button onClick={() => handleDelete(r.id)} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-destructive">
                  削除
                </button>
              </div>
            </div>
            {r.note && <div className="mt-1.5 text-[11.5px] text-muted-foreground">メモ: {r.note}</div>}
            {editingId === r.id && (
              <ExpenseEditForm
                record={r}
                onDone={() => {
                  setEditingId(null);
                  load();
                  onChanged();
                }}
                onCancel={() => setEditingId(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpenseEditForm({ record, onDone, onCancel }: { record: ExpenseRecord; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(record.date);
  const [amount, setAmount] = useState(String(record.amountUsd));
  const [category, setCategory] = useState(record.category);
  const [vendor, setVendor] = useState(record.vendor ?? '');
  const [note, setNote] = useState(record.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const amountNum = Number(amount);
    if (!date || !(amountNum > 0) || !category.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateExpense(record.id, {
        date,
        amountUsd: amountNum,
        category: category.trim(),
        vendor: vendor.trim() || null,
        note: note.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5">
      <div className="flex flex-wrap gap-2.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-28 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="費目" className="h-9 w-32 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="仕入れ先 (任意)" className="h-9 w-36 rounded-lg border border-border px-2.5 text-[12.5px]" />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ (任意)" className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
      {error && <div className="text-[11.5px] text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="h-9 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60">
          {saving ? '保存中…' : '保存'}
        </button>
        <button onClick={onCancel} className="h-9 rounded-lg border border-border px-3.5 text-[12px] font-semibold">
          キャンセル
        </button>
      </div>
    </div>
  );
}

function MasterListsSection({
  vendors,
  categories,
  onChanged,
}: {
  vendors: ExpenseVendor[];
  categories: ExpenseCategory[];
  onChanged: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <MasterListCard
        title="仕入れ先・買い物先マスタ"
        items={vendors}
        placeholder="例: セントラルマーケット、〇〇商店"
        onAdd={(name) => createExpenseVendor(name)}
        onDelete={(id) => deleteExpenseVendor(id)}
        onChanged={onChanged}
      />
      <MasterListCard
        title="費目マスタ"
        items={categories}
        placeholder="例: 雑費、仕入れ、消耗品"
        onAdd={(name) => createExpenseCategory(name)}
        onDelete={(id) => deleteExpenseCategory(id)}
        onChanged={onChanged}
      />
    </div>
  );
}

function MasterListCard({
  title,
  items,
  placeholder,
  onAdd,
  onDelete,
  onChanged,
}: {
  title: string;
  items: { id: string; name: string }[];
  placeholder: string;
  onAdd: (name: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(name);
      setNewName('');
      onChanged();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '追加に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await onDelete(id);
      onChanged();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 text-[13px] font-semibold">{title}</div>
      {error && <div className="mb-2 text-[11.5px] text-destructive">{error}</div>}
      <div className="mb-2.5 flex flex-col gap-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-[12.5px]">
            {item.name}
            <button disabled={busy} onClick={() => remove(item.id)} className="text-[11px] font-semibold text-destructive disabled:opacity-50">
              削除
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="text-[11.5px] text-muted-foreground">未登録です。</div>}
      </div>
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          className="h-9 flex-1 rounded-lg border border-border px-2.5 text-[12.5px] disabled:opacity-60"
        />
        <button disabled={busy || !newName.trim()} onClick={add} className="h-9 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60">
          追加
        </button>
      </div>
    </div>
  );
}
