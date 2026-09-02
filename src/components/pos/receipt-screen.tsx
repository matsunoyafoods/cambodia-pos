'use client';

import { useState } from 'react';
import { money } from '@/lib/money';
import { useLanguage } from './language-context';

export function ReceiptScreen({
  selectedTable,
  total,
  onNewOrder,
  onReprintReceipt,
  reprintBusy,
  canIssueInvoice,
  onIssueInvoice,
  invoiceBusy,
  invoiceError,
  invoiceIssued,
}: {
  selectedTable: string | null;
  total: number;
  onNewOrder: () => void;
  /** 顧客控え(レシート)の再印刷 (2026-08-31 追加) */
  onReprintReceipt: () => void;
  reprintBusy: boolean;
  /** 直前の会計内容がまだ手元にあり、領収書を発行できるか (2026-08-31 追加) */
  canIssueInvoice: boolean;
  onIssueInvoice: (recipientName: string, description: string) => Promise<void>;
  invoiceBusy: boolean;
  invoiceError: string | null;
  invoiceIssued: boolean;
}) {
  const { t } = useLanguage();
  const [invoiceFormOpen, setInvoiceFormOpen] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [description, setDescription] = useState('');

  async function handleIssueInvoice() {
    await onIssueInvoice(recipientName, description);
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-[360px] flex-col items-center gap-3.5 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
          ✓
        </div>
        <div className="text-lg font-bold">{t('receipt.completedTitle')}</div>
        <div className="text-[13px] text-muted-foreground">
          {t('receipt.summary', { table: selectedTable ?? '', total: `$${money(total)}` })}
          <br />
          {t('receipt.printingNote')}
        </div>
        <button
          onClick={onNewOrder}
          className="mt-2 h-12 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          {t('receipt.backToTableMap')}
        </button>
        <button
          onClick={onReprintReceipt}
          disabled={reprintBusy}
          className="h-11 w-full rounded-lg border border-border bg-card text-[13.5px] font-semibold disabled:opacity-60"
        >
          {reprintBusy ? t('cart.submitting') : t('receipt.reprintButton')}
        </button>

        {canIssueInvoice && !invoiceFormOpen && !invoiceIssued && (
          <button
            onClick={() => setInvoiceFormOpen(true)}
            className="h-11 w-full rounded-lg border border-border bg-card text-[13.5px] font-semibold"
          >
            {t('receipt.issueInvoiceButton')}
          </button>
        )}

        {invoiceIssued && (
          <div className="w-full rounded-lg bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-emerald-700">
            {t('receipt.invoiceQueuedNote')}
          </div>
        )}

        {canIssueInvoice && invoiceFormOpen && !invoiceIssued && (
          <div className="flex w-full flex-col gap-2 rounded-lg border border-border p-3 text-left">
            <div className="text-[12.5px] font-semibold">{t('receipt.invoiceFormTitle')}</div>
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">{t('receipt.recipientLabel')}</div>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder={t('receipt.recipientPlaceholder')}
                className="h-9 w-full rounded-md border border-border px-2.5 text-[12.5px]"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">{t('receipt.descriptionLabel')}</div>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('receipt.descriptionPlaceholder')}
                className="h-9 w-full rounded-md border border-border px-2.5 text-[12.5px]"
              />
            </div>
            {invoiceError && <div className="text-[11px] text-destructive">{invoiceError}</div>}
            <div className="flex gap-2">
              <button
                onClick={handleIssueInvoice}
                disabled={invoiceBusy}
                className="h-9 flex-1 rounded-md bg-primary text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
              >
                {invoiceBusy ? t('receipt.issuing') : t('receipt.issueButton')}
              </button>
              <button
                onClick={() => setInvoiceFormOpen(false)}
                disabled={invoiceBusy}
                className="h-9 rounded-md border border-border px-3 text-[12.5px] font-semibold text-muted-foreground disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
