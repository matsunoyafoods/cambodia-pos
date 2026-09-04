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
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';
import { localeForLang } from '@/lib/i18n/lang';

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
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <ExpensesScreenInner />
    </LanguageProvider>
  );
}

function ExpensesScreenInner() {
  const { t } = useLanguage();
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
      .catch((err) => setMastersError(err instanceof PosExpenseApiError ? err.message : t('expenses.mastersLoadError')));
  }, [isPosNative, t]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background print:h-auto print:overflow-visible">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3 print:hidden">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t('expenses.title')}</div>
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
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-900">
      <p className="mb-2 font-bold">{t('common.posNativeOnlyTitle')}</p>
      <p className="mb-3 text-[13px] leading-relaxed">{t('common.posNativeOnlyBody')}</p>
      <a
        href="/login"
        className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-primary-foreground shadow-md"
      >
        {t('common.posNativeOnlyLoginLink')}
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
  const { t } = useLanguage();
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
      .catch((err) => setError(err instanceof PosCashApiError ? err.message : t('cash.balanceLoadError')));
  }, [t]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleDeleteDeposit(id: string) {
    if (!confirm(t('cash.deleteDepositConfirm'))) return;
    try {
      await deleteCashDeposit(id);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof PosCashApiError ? err.message : t('common.deleteError'));
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 text-[13.5px] font-semibold">{t('cash.balanceTitle')}</div>
      {error && <div className="mb-2 text-[12.5px] text-destructive">{error}</div>}
      {!balance ? (
        <div className="text-[12.5px] text-muted-foreground">{t('common.loadingEllipsis')}</div>
      ) : (
        <>
          <div className="mb-3 rounded-xl bg-secondary/40 px-4 py-3.5">
            <div className="text-[11px] text-muted-foreground">{t('cash.expectedCashLabel')}</div>
            <div className="text-[24px] font-bold">${balance.balance.toFixed(2)}</div>
            <div className="mt-1.5 text-[11.5px] text-muted-foreground">
              {t('cash.balanceBreakdown', {
                sales: balance.cashSalesTotal.toFixed(2),
                deposits: balance.bankDepositsTotal.toFixed(2),
                expenses: balance.cashExpensesTotal.toFixed(2),
              })}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {balance.lastClosingDate ? t('cash.lastClosingDate', { date: balance.lastClosingDate }) : t('cash.noClosingYet')}
            </div>
          </div>

          <CashDepositForm
            onCreated={() => {
              load();
              onChanged();
            }}
          />

          <button onClick={() => setShowHistory((v) => !v)} className="mt-3 text-[12px] font-semibold text-primary">
            {showHistory ? t('cash.hideHistory') : t('cash.showHistory', { count: deposits?.length ?? 0 })}
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col gap-1.5">
              {(deposits ?? []).length === 0 && <div className="text-[12px] text-muted-foreground">{t('cash.noDepositsYet')}</div>}
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
                    {t('common.delete')}
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
  const { t } = useLanguage();
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
      setError(err instanceof PosCashApiError ? err.message : t('common.registerError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-3.5">
      <div className="mb-2 text-[12.5px] font-semibold">{t('cash.depositFormTitle')}</div>
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {t('common.dateLabel')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {t('cash.depositAmountLabel')}
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
          placeholder={t('common.notePlaceholder')}
          className="h-9 flex-1 rounded-lg border border-border px-2.5 text-[12.5px]"
        />
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="h-9 rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-40"
        >
          {submitting ? t('common.registering') : t('common.recordButton')}
        </button>
      </div>
      {error && <div className="mt-2 text-[11.5px] text-destructive">{error}</div>}
      {done && !error && <div className="mt-2 text-[11.5px] text-emerald-600">{t('cash.recorded')}</div>}
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
  const { t } = useLanguage();
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
          setPhotoWarning(t('expenses.photoUploadWarning'));
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
      setError(err instanceof PosExpenseApiError ? err.message : t('common.registerError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 text-[13.5px] font-semibold">{t('expenses.recordExpenseTitle')}</div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2.5">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            {t('common.dateLabel')}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            {t('expenses.amountLabel')}
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
            {t('expenses.categoryLabel')}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-48 rounded-lg border border-border px-2.5 text-[13px]">
              <option value="">{t('expenses.selectPlaceholder')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value="__other__">{t('expenses.otherFreeInput')}</option>
            </select>
          </label>
          {category === '__other__' && (
            <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
              {t('expenses.categoryNameLabel')}
              <input value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} className="h-10 w-40 rounded-lg border border-border px-2.5 text-[13px]" />
            </label>
          )}

          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            {t('expenses.vendorLabel')}
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-10 w-48 rounded-lg border border-border px-2.5 text-[13px]">
              <option value="">{t('expenses.noSelection')}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.name}>
                  {v.name}
                </option>
              ))}
              <option value="__other__">{t('expenses.otherFreeInput')}</option>
            </select>
          </label>
          {vendor === '__other__' && (
            <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
              {t('expenses.vendorNameLabel')}
              <input value={vendorOther} onChange={(e) => setVendorOther(e.target.value)} className="h-10 w-40 rounded-lg border border-border px-2.5 text-[13px]" />
            </label>
          )}
        </div>

        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.notePlaceholder')} className="h-10 rounded-lg border border-border px-2.5 text-[13px]" />

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="radio" checked={paymentStatus === 'paid'} onChange={() => setPaymentStatus('paid')} />
            {t('expenses.paidStatus')}
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="radio" checked={paymentStatus === 'unpaid'} onChange={() => setPaymentStatus('unpaid')} />
            {t('expenses.unpaidStatus')}
          </label>
        </div>

        {paymentStatus === 'paid' && (
          <div className="flex items-center gap-4">
            <span className="text-[11.5px] text-muted-foreground">{t('expenses.paidFromLabel')}</span>
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="radio" checked={paidFrom === 'register_cash'} onChange={() => setPaidFrom('register_cash')} />
              {t('expenses.paidFromRegisterCash')}
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="radio" checked={paidFrom === 'other'} onChange={() => setPaidFrom('other')} />
              {t('expenses.paidFromOtherFull')}
            </label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="flex h-10 w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-semibold">
            📷 {t('expenses.receiptPhotoLabel')}
            <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
          </label>
          {photoPreviewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreviewUrl} alt={t('expenses.receiptPreviewAlt')} className="h-10 w-10 rounded-md border border-border object-cover" />
          )}
        </div>

        {error && <div className="text-[12.5px] text-destructive">{error}</div>}
        {photoWarning && <div className="text-[12.5px] text-amber-600">{photoWarning}</div>}
        {done && !error && <div className="text-[12.5px] text-emerald-600">{t('expenses.registered')}</div>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="h-11 w-fit rounded-lg bg-primary px-6 text-[13.5px] font-bold text-primary-foreground disabled:opacity-40"
        >
          {submitting ? t('common.registering') : t('common.recordButton')}
        </button>
      </div>
    </div>
  );
}

function ExpenseReport({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const { t, lang } = useLanguage();
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
      .catch((err) => setError(err instanceof PosExpenseApiError ? err.message : t('expenses.listLoadError')));
  }, [from, to, statusFilter, t]);

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
      setError(err instanceof PosExpenseApiError ? err.message : t('expenses.settleError'));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('expenses.deleteConfirm'))) return;
    try {
      await deleteExpense(id);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : t('common.deleteError'));
    }
  }

  function handleCsvExport() {
    if (!rows || rows.length === 0) return;
    downloadCsv(
      `${t('expenses.csvFilename')}_${from}_${to}`,
      [
        t('common.dateLabel'),
        t('expenses.csvAmount'),
        t('expenses.categoryLabel'),
        t('expenses.csvVendor'),
        t('expenses.csvNote'),
        t('expenses.csvPaymentStatus'),
        t('expenses.csvSettledDate'),
        t('expenses.paidFromLabel'),
      ],
      rows.map((r) => [
        r.date,
        r.amountUsd.toFixed(2),
        r.category,
        r.vendor ?? '',
        r.note ?? '',
        r.paymentStatus === 'paid' ? t('expenses.paidStatus') : t('expenses.unpaidBadge'),
        r.paidAt ? r.paidAt.slice(0, 10) : '',
        r.paymentStatus === 'paid' ? (r.paidFrom === 'register_cash' ? t('expenses.paidFromRegisterCash') : t('expenses.paidFromOtherShort')) : '',
      ]),
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 print:border-0 print:p-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 print:hidden">
        <div className="text-[13.5px] font-semibold">{t('expenses.reportTitle')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <span className="text-[12px] text-muted-foreground">〜</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | ExpensePaymentStatus)} className="h-9 rounded-lg border border-border px-2 text-[12.5px]">
            <option value="all">{t('expenses.filterAll')}</option>
            <option value="paid">{t('expenses.paidStatus')}</option>
            <option value="unpaid">{t('expenses.filterUnpaidOnly')}</option>
          </select>
          <button onClick={load} className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold">
            {t('common.refresh')}
          </button>
          <button
            onClick={handleCsvExport}
            disabled={!rows || rows.length === 0}
            className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-50"
          >
            {t('common.csvExportButton')}
          </button>
          <button
            onClick={() => printReport(`${t('expenses.csvFilename')}_${from}_${to}`)}
            disabled={!rows || rows.length === 0}
            className="h-9 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t('common.pdfExportButton')}
          </button>
        </div>
      </div>

      {/* 印刷時のみ表示するヘッダー (店名・期間・絞り込み条件・出力日時) */}
      <div className="hidden print:mb-4 print:block">
        <div className="text-[16px] font-bold">{t('expenses.reportTitle')}{me.store_name ? ` — ${me.store_name}` : ''}</div>
        <div className="text-[12px] text-muted-foreground">
          {t('common.printHeaderPeriod', { from, to })} ・ {t('expenses.printHeaderStatus', { status: statusFilter === 'all' ? t('expenses.filterAll') : statusFilter === 'paid' ? t('expenses.paidStatus') : t('expenses.filterUnpaidOnly') })} ・{' '}
          {t('common.printHeaderGenerated', { datetime: new Date().toLocaleString(localeForLang(lang)) })}
        </div>
      </div>

      {rows && (
        <div className="mb-3 flex gap-5 rounded-lg bg-secondary/40 px-4 py-2.5 text-[12.5px] print:rounded-none print:bg-transparent print:px-0">
          <div>
            {t('expenses.totalLabel')} <span className="font-semibold">${total.toFixed(2)}</span>
          </div>
          <div>
            {t('expenses.unpaidTotalLabel')} <span className="font-semibold text-amber-600">${unpaidTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {error && <div className="mb-2 text-[12.5px] text-destructive print:hidden">{error}</div>}
      {!rows && <div className="text-[12.5px] text-muted-foreground">{t('common.loadingEllipsis')}</div>}
      {rows?.length === 0 && <div className="text-[12.5px] text-muted-foreground">{t('expenses.noRecordsForFilter')}</div>}

      <div className="flex flex-col gap-2 print:gap-1.5">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-lg border border-border px-3.5 py-2.5 print:rounded-none print:border-0 print:border-b print:px-0 print:py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 text-[13px]">
                {r.receiptImageUrl && (
                  <a href={r.receiptImageUrl} target="_blank" rel="noopener noreferrer" className="print:hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.receiptImageUrl} alt={t('expenses.receiptAlt')} className="h-9 w-9 rounded-md border border-border object-cover" />
                  </a>
                )}
                <span>
                  <span className="font-semibold">${r.amountUsd.toFixed(2)}</span>
                  <span className="ml-2 text-muted-foreground">
                    {r.date} ・ {r.category}
                    {r.vendor && ` ・ ${r.vendor}`}
                  </span>
                  {r.paymentStatus === 'unpaid' ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">{t('expenses.unpaidBadge')}</span>
                  ) : (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 print:hidden">{t('expenses.paidStatus')}</span>
                  )}
                  {r.paymentStatus === 'paid' && r.paidFrom === 'register_cash' && (
                    <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground print:hidden">{t('expenses.registerCashBadge')}</span>
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
                      <option value="other">{t('expenses.settleWithOther')}</option>
                      <option value="register_cash">{t('expenses.settleWithRegisterCash')}</option>
                    </select>
                    <button onClick={() => handleSettle(r.id)} className="rounded-md border border-emerald-600 px-2 py-1 text-[11.5px] font-semibold text-emerald-700">
                      {t('expenses.settleButton')}
                    </button>
                  </>
                )}
                <button onClick={() => setEditingId((v) => (v === r.id ? null : r.id))} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold">
                  {t('common.edit')}
                </button>
                <button onClick={() => handleDelete(r.id)} className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-destructive">
                  {t('common.delete')}
                </button>
              </div>
            </div>
            {r.note && <div className="mt-1.5 text-[11.5px] text-muted-foreground">{t('expenses.noteLine', { note: r.note })}</div>}
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
  const { t } = useLanguage();
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
      setError(err instanceof PosExpenseApiError ? err.message : t('common.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    if (!confirm(t('expenses.deletePhotoConfirm'))) return;
    setDeletingPhoto(true);
    setError(null);
    try {
      await deleteExpenseReceipt(record.id);
      setReceiptUrl(null);
    } catch (err) {
      setError(err instanceof PosExpenseApiError ? err.message : t('expenses.deletePhotoError'));
    } finally {
      setDeletingPhoto(false);
    }
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5 print:hidden">
      <div className="flex flex-wrap gap-2.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-28 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('expenses.categoryLabel')} className="h-9 w-32 rounded-lg border border-border px-2.5 text-[12.5px]" />
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder={t('expenses.vendorOptionalPlaceholder')} className="h-9 w-36 rounded-lg border border-border px-2.5 text-[12.5px]" />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common.notePlaceholder')} className="h-9 rounded-lg border border-border px-2.5 text-[12.5px]" />
      {record.paymentStatus === 'paid' && (
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-muted-foreground">{t('expenses.paidFromLabel')}</span>
          <label className="flex items-center gap-1.5 text-[12px]">
            <input type="radio" checked={paidFrom === 'register_cash'} onChange={() => setPaidFrom('register_cash')} />
            {t('expenses.paidFromRegisterCash')}
          </label>
          <label className="flex items-center gap-1.5 text-[12px]">
            <input type="radio" checked={paidFrom === 'other'} onChange={() => setPaidFrom('other')} />
            {t('expenses.paidFromOtherShort')}
          </label>
        </div>
      )}
      {receiptUrl && (
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={receiptUrl} alt={t('expenses.receiptAlt')} className="h-16 w-16 rounded-md border border-border object-cover" />
          <button onClick={removePhoto} disabled={deletingPhoto} className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-semibold text-destructive disabled:opacity-60">
            {deletingPhoto ? t('expenses.deletingPhoto') : t('expenses.deletePhotoButton')}
          </button>
        </div>
      )}
      {error && <div className="text-[11.5px] text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="h-9 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60">
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button onClick={onCancel} className="h-9 rounded-lg border border-border px-3.5 text-[12px] font-semibold">
          {t('common.cancel')}
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
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <MasterListCard
        title={t('expenses.vendorMasterTitle')}
        items={vendors}
        placeholder={t('expenses.vendorMasterPlaceholder')}
        onAdd={(name) => createExpenseVendor(name)}
        onDelete={(id) => deleteExpenseVendor(id)}
        onChanged={onChanged}
      />
      <MasterListCard
        title={t('expenses.categoryMasterTitle')}
        items={categories}
        placeholder={t('expenses.categoryMasterPlaceholder')}
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
  const { t } = useLanguage();
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
      setError(err instanceof PosExpenseApiError ? err.message : t('common.addError'));
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
      setError(err instanceof PosExpenseApiError ? err.message : t('common.deleteError'));
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
              {t('common.delete')}
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="text-[11.5px] text-muted-foreground">{t('expenses.masterEmpty')}</div>}
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
          {t('common.add')}
        </button>
      </div>
    </div>
  );
}
