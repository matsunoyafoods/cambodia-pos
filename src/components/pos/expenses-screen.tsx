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
  deleteExpenseReceipt,
  deleteExpenseVendor,
  listExpenseCategories,
  listExpenseVendors,
  listExpenses,
  PosExpenseApiError,
  settleExpense,
  updateExpense,
  uploadExpenseReceipt,
} from '@/lib/expense-client';
import { downloadCsv } from '@/lib/csv-export';
import type { ExpenseCategory, ExpensePaidFrom, ExpensePaymentStatus, ExpenseRecord, ExpenseVendor } from '@/lib/pos-types';
import { createCashDeposit, deleteCashDeposit, getCashBalance, listCashDeposits, PosCashApiError, type CashBalance, type CashDepositRecord } from '@/lib/cash-client';

// 経費管理画面 (2026-08-31 追加)。
// 「経費はよく買うところなどは登録できるようにしましょう！経費は雑費や仕入れなどの項目も登録して
// 選べるようにしましょう！買掛もできるようにね。」への対応。
// - 上部: 誰でも使えるクイック入力フォーム (立て替え購入をその場で記録)
// - 下部: manager 以上限定のレポート (期間絞り込み・合計・編集・削除・買掛の精算) と
//   仕入れ先/費目マスタの管理

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// PDF出力 (2026-09-01 追加。Tom「経費もタイムカードもPDF出力できるようにして欲しい」)。
// 専用のPDFライブラリは追加せず、ブラウザの印刷機能 (印刷ダイアログの「PDFとして保存」) を使う
// 方式にした。QRコード印刷画面と同じ考え方で、サーバー側でPDF生成の仕組みを新設せずに済む。
function printReport(title: string) {
  const prevTitle = document.title;
  document.title = title;
  window.print();
  document.title = prevTitle;
}

export function ExpensesScreen() {
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = me.role === 'owner' || me.role === 'manager';

  const [vendors, setVendors] = useState<ExpenseVendor[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [mastersError, setMastersError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadMasters = useCallback(() => {
    if (!isPosNative) return;
    Promise.all([listExpenseVendors(), listExpenseCategories()])
      .then(([v, c]) => {
        setVendors(v);
        setCategories(c);
      })
      .catch((err) => setMastersError(err instanceof PosExpenseApiError ? err.message : 'マスタの取得に失敗しました'));
  }, [isPosNative]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3 print:hidden">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← レジ画面へ
        </button>
        <div className="text-[15px] font-bold">経費</div>
      </div>
      <div className="flex-1 overflow-auto p-5 print:overflow-visible print:p-0">
        <div className="mx-auto flex max-w-[820px] flex-col gap-6 print:max-w-none">
          {!isPosNative ? (
            <PosNativeOnlyNotice />
          ) : (
            <>
              {mastersError && <div className="text-[12.5px] text-destructive print:hidden">{mastersError}</div>}
              <div className="print:hidden">
                <QuickEntryForm
                  vendors={vendors}
                  categories={categories}
                  onCreated={() => setRefreshKey((k) => k + 1)}
                />
              </div>
              {canManage && (
                <>
                  <div className="print:hidden">
                    <CashBalanceCard refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
                  </div>
                  <ExpenseReport refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
                  <div className="print:hidden">
                    <MasterListsSection vendors={vendors} categories={categories} onChanged={loadMasters} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 経費・勤怠は POS PIN ログイン (pos_staff_session Cookie) 専用の API しか無いため、
// matsunoya-dine ログイン (authMode 'dine') で /pos に入っているスタッフには、生の
// "unauthorized" エラーではなくこの案内を出す (2026-09-01 追加。dine ログインでは
// この画面のデータが扱えない、という Tom への説明に対応)。
// dine 対応は別途 matsunoya-dine 側に署名付きトークン発行 API を追加する必要があり、
// 今回は見送り (「I'm hungryアプリ」チャット側の対応事項として later)。
function PosNativeOnlyNotice() {
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
      <p className="mb-2 font-bold">POS PINログインが必要です</p>
      <p className="mb-3 text-[13px] leading-relaxed">
        経費・勤怠は現在、POS PINログイン (スタッフ選択 + PINでのログイン) をした端末専用です。matsunoya-dine
        (Telegram) のログインだけではこの画面のデータは扱えません。
      </p>
      <a
        href="/login"
        className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md"
      >
        PINでログインする
      </a>
    </div>
  );
}

// 現金残高・銀行入金 (2026-09-02 追加)。
// Tom「レジの中に現金売上が貯まります。現金売上を銀行入金します。現金売上残高がいくらあるか
// 分かるようにしたいです。」への対応。
// 現金残高 = Σ(確定したレジ締めの現金売上) − Σ(銀行入金) − Σ(レジの現金で払った経費、支払い済みのみ)。
// 常に元データから計算する (この画面では表示のみ。レジ締め自体は /pos/register-closing で行う)。
function CashBalanceCard({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [balance, setBalance] = useState<CashBalance | null>(null);
  const [deposits, setDeposits] = useState<CashDepositRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([getCashBalance(), listCashDeposits()])
      .then(([b, d]) => {
        setBalance(b);
        setDeposits(d);
      })
      .catch((err) => setError(err instanceof PosCashApiError ? err.message : '現金残高の取得に失敗しました'));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleDeleteDeposit(id: string) {
    if (!confirm('この銀行入金の記録を削除しますか？')) return;
    try {
      await deleteCashDeposit(id);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof PosCashApiError ? err.message : '削除に失敗しました');
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 text-[13.5px] font-semibold">現金残高</div>
      {error && <div className="mb-2 text-[12.5px] text-destructive">{error}</div>}
      {!balance ? (
        <div className="text-[12.5px] text-muted-foreground">読み込み中…</div>
      ) : (
        <>
          <div className="mb-3 rounded-xl bg-secondary/40 px-4 py-3.5">
            <div className="text-[11px] text-muted-foreground">レジにあるはずの現金 (概算)</div>
            <div className="text-[24px] font-bold">${balance.balance.toFixed(2)}</div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              現金売上 ${balance.cashSalesTotal.toFixed(2)} − 銀行入金 ${balance.bankDepositsTotal.toFixed(2)} − 現金払いの経費 $
              {balance.cashExpensesTotal.toFixed(2)}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {balance.lastClosingDate ? `最後にレジ締めした日: ${balance.lastClosingDate}` : 'まだレジ締めが確定されていません (レジ締め画面から確定してください)'}
            </div>
          </div>

          <CashDepositForm
            onCreated={() => {
              load();
              onChanged();
            }}
          />

          <button onClick={() => setShowHistory((v) => !v)} className="mt-3 text-[12px] font-semibold text-primary">
            {showHistory ? '入金履歴を隠す' : `入金履歴を見る (${deposits?.length ?? 0}件)`}
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col gap-1.5">
              {(deposits ?? []).length === 0 && <div className="text-[12px] text-muted-foreground">まだ銀行入金の記録はありません。</div>}
              {deposits?.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12.5px]">
                  <div>
                    <span className="font-semibold">${d.amountUsd.toFixed(2)}</span>
                    <span className="ml-2 text-muted-foreground">
                      {d.date}
                      {d.note ? ` ・ ${d.note}` : ''} ・ {d.createdByName ?? '-'}
                    </span>
                  </div>
                  <button onClick={() => handleDeleteDeposit(d.id)} className="text-[11px] font-semibold text-destructive">
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CashDepositForm({ onCreated }: { onCreated: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const amountNum = Number(amount);
  const canSubmit = date && amountNum > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      await createCashDeposit({ date, amountUsd: amountNum, note: note.trim() || undefined });
      setAmount('');
      setNote('');
      setDone(true);
      onCreated();
    } catch (err) {
      setError(err instanceof PosCashApiError ? err.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-3.5">
      <div className="mb-2 text-[12.5px] font-semibold">銀行入金を記録する</div>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          日付
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          入金額 (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="h-9 w-28 rounded-lg border border-border px-2.5 text-[12.5px]"
          />
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="メモ (任意)"
          className="h-9 flex-1 rounded-lg border border-border px-2.5 text-[12.5px]"
        />
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="h-9 rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-40"
        >
          {submitting ? '登録中…' : '記録する'}
        </button>
      </div>
      {error && <div className="mt-2 text-[11.5px] text-destructive">{error}</div>}
      {done && !error && <div className="mt-2 text-[11.5px] text-emerald-600">記録しました。</div>}
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
  // 支払い元 (2026-09-02 追加)。レジの現金から払った経費は現金残高から自動で引かれるため、
  // 誤って残高が減らないよう既定値は「その他」にしている (実際にレジ現金を使った時だけ選ぶ)。
  const [paidFrom, setPaidFrom] = useState<ExpensePaidFrom>('other');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const resolvedCategory = category === '__other__' ? categoryOther.trim() : category;
  const resolvedVendor = vendor === '__other__' ? vendorOther.trim() : vendor;
  const amountNum = Number(amount);
  const canSubmit = date && amountNum > 0 && resolvedCategory.length > 0 && !submitting;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhoto(file);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setPhotoWarning(null);
    setDone(false);
    try {
      const created = await createExpense({
        date,
        amountUsd: amountNum,
        category: resolvedCategory,
        vendor: resolvedVendor || undefined,
        note: note.trim() || undefined,
        paymentStatus,
        paidFrom: paymentStatus === 'paid' ? paidFrom : undefined,
      });
      // 写真アップロードが失敗しても経費の記録自体は成功しているので、警告表示のみに留める
      // (記録全体を失敗扱いにして再入力させると二重登録の原因になる)。
      if (photo) {
        try {
          await uploadExpenseReceipt(created.id, photo);
        } catch {
          setPhotoWarning('経費は記録されましたが、写真のアップロードに失敗しました。経費レポートの編集から後で添付できます。');
        }
      }
      setAmount('');
      setNote('');
      setPaidFrom('other');
      setPhoto(null);
      setPhotoPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
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

        {paymentStatus === 'paid' && (
          <div className="flex items-center gap-4">
            <span className="text-[11.5px] text-muted-foreground">支払い元:</span>
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="radio" checked={paidFrom === 'register_cash'} onChange={() => setPaidFrom('register_cash')} />
              レジの現金
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="radio" checked={paidFrom === 'other'} onChange={() => setPaidFrom('other')} />
              その他 (銀行振込・立て替え等)
            </label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="flex h-10 w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-semibold">
            📷 レシート写真 (任意)
            <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
          </label>
          {photoPreviewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreviewUrl} alt="レシートプレビュー" className="h-10 w-10 rounded-md border border-border object-cover" />
          )}
        </div>

        {error && <div className="text-[12.5px] text-destructive">{error}</div>}
        {photoWarning && <div className="text-[12.5px] text-amber-600">{photoWarning}</div>}
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
  const me = useStaff();
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

  // 精算時に初めて現金 (または他の方法) が動くため、支払い元をここで選ばせる
  // (2026-09-02 追加。現金残高計算のため — 行ごとに選択を保持する)。
  const [settlePaidFrom, setSettlePaidFrom] = useState<Record<string, ExpensePaidFrom>>({});

  async function handleSettle(id: string) {
    try {
      await settleExpense(id, settlePaidFrom[id] ?? 'other');
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

  function handleCsvExport() {
    if (!rows || rows.length === 0) return;
    downloadCsv(
      `経費レポート_${from}_${to}`,
      ['日付', '金額(USD)', '費目', '仕入れ先', 'メモ', '支払い状況', '精算日', '支払い元'],
      rows.map((r) => [
        r.date,
        r.amountUsd.toFixed(2),
        r.category,
        r.vendor ?? '',
        r.note ?? '',
        r.paymentStatus === 'paid' ? '支払い済み' : '買掛',
        r.paidAt ? r.paidAt.slice(0, 10) : '',
        r.paymentStatus === 'paid' ? (r.paidFrom === 'register_cash' ? 'レジの現金' : 'その他') : '',
      ]),
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-0 print:p-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 print:hidden">
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
          <button
            onClick={handleCsvExport}
            disabled={!rows || rows.length === 0}
            className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
          >
            CSV出力
          </button>
          <button
            onClick={() => printReport(`経費レポート_${from}_${to}`)}
            disabled={!rows || rows.length === 0}
            className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            PDF出力
          </button>
        </div>
      </div>

      {/* 印刷時のみ表示するヘッダー (店名・期間・絞り込み条件・出力日時) */}
      <div className="hidden print:mb-4 print:block">
        <div className="text-[16px] font-bold">経費レポート{me.store_name ? ` — ${me.store_name}` : ''}</div>
        <div className="text-[12px] text-muted-foreground">
          対象期間: {from} 〜 {to} ・ 支払い状況: {statusFilter === 'all' ? 'すべて' : statusFilter === 'paid' ? '支払い済み' : '買掛のみ'} ・ 出力日時:{' '}
          {new Date().toLocaleString('ja-JP')}
        </div>
      </div>

      {rows && (
        <div className="mb-3 flex gap-5 rounded-lg bg-secondary/40 px-4 py-2.5 text-[12.5px] print:rounded-none print:bg-transparent print:px-0">
          <div>
            合計: <span className="font-semibold">${total.toFixed(2)}</span>
          </div>
          <div>
            うち買掛 (未払い): <span className="font-semibold text-amber-600">${unpaidTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {error && <div className="mb-2 text-[12.5px] text-destructive print:hidden">{error}</div>}
      {!rows && <div className="text-[12.5px] text-muted-foreground">読み込み中…</div>}
      {rows?.length === 0 && <div className="text-[12.5px] text-muted-foreground">この条件の経費記録はありません。</div>}

      <div className="flex flex-col gap-2 print:gap-1.5">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-lg border border-border px-3.5 py-2.5 print:rounded-none print:border-0 print:border-b print:px-0 print:py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 text-[13px]">
                {r.receiptImageUrl && (
                  <a href={r.receiptImageUrl} target="_blank" rel="noopener noreferrer" className="print:hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.receiptImageUrl} alt="レシート" className="h-9 w-9 rounded-md border border-border object-cover" />
                  </a>
                )}
                <span>
                  <span className="font-semibold">${r.amountUsd.toFixed(2)}</span>
                  <span className="ml-2 text-muted-foreground">
                    {r.date} ・ {r.category}
                    {r.vendor && ` ・ ${r.vendor}`}
                  </span>
                  {r.paymentStatus === 'unpaid' ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">買掛</span>
                  ) : (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 print:hidden">支払い済み</span>
                  )}
                  {r.paymentStatus === 'paid' && r.paidFrom === 'register_cash' && (
                    <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground print:hidden">レジ現金</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                {r.paymentStatus === 'unpaid' && (
                  <>
                    <select
                      value={settlePaidFrom[r.id] ?? 'other'}
                      onChange={(e) => setSettlePaidFrom((prev) => ({ ...prev, [r.id]: e.target.value as ExpensePaidFrom }))}
                      className="h-7 rounded-md border border-border px-1.5 text-[11px]"
                    >
                      <option value="other">その他で精算</option>
                      <option value="register_cash">レジ現金で精算</option>
                    </select>
                    <button onClick={() => handleSettle(r.id)} className="rounded-md border border-emerald-600 px-2 py-1 text-[11.5px] font-semibold text-emerald-700">
                      精算する
                    </button>
                  </>
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
  const [paidFrom, setPaidFrom] = useState<ExpensePaidFrom>(record.paidFrom);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState(record.receiptImageUrl);
  const [deletingPhoto, setDeletingPhoto] = useState(false);

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
        paidFrom: record.paymentStatus === 'paid' ? paidFrom : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    if (!confirm('レシート写真を削除しますか？')) return;
    setDeletingPhoto(true);
    setError(null);
    try {
      await deleteExpenseReceipt(record.id);
      setReceiptUrl(null);
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : '写真の削除に失敗しました');
    } finally {
      setDeletingPhoto(false);
    }
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5 print:hidden">
      <div className="flex flex-wrap gap-2.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-28 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="費目" className="h-9 w-32 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="仕入れ先 (任意)" className="h-9 w-36 rounded-lg border border-border px-2.5 text-[12.5px]" />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ (任意)" className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
      {record.paymentStatus === 'paid' && (
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-muted-foreground">支払い元:</span>
          <label className="flex items-center gap-1.5 text-[12px]">
            <input type="radio" checked={paidFrom === 'register_cash'} onChange={() => setPaidFrom('register_cash')} />
            レジの現金
          </label>
          <label className="flex items-center gap-1.5 text-[12px]">
            <input type="radio" checked={paidFrom === 'other'} onChange={() => setPaidFrom('other')} />
            その他
          </label>
        </div>
      )}
      {receiptUrl && (
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={receiptUrl} alt="レシート" className="h-16 w-16 rounded-md border border-border object-cover" />
          <button onClick={removePhoto} disabled={deletingPhoto} className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-semibold text-destructive disabled:opacity-60">
            {deletingPhoto ? '削除中…' : '写真を削除'}
          </button>
        </div>
      )}
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
