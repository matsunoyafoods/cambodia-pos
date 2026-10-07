'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { LanguageProvider, useLanguage, GUEST_LANGUAGE_STORAGE_KEY } from './language-context';
import { LanguagePickerScreen } from './language-picker-screen';
import { money } from '@/lib/money';

// お客様向け注文明細・レシート画面 (2026-10-06 追加。QR+ABA決済フロー フェーズ1)。
// /receipt/[token] (認証なし公開ページ) から呼ばれる。qr-order-app.tsx と同じく、
// 初回アクセス時だけ言語選択を挟み (GUEST_LANGUAGE_STORAGE_KEY は端末=ブラウザ単位で
// QRセルフオーダーと共有)、以降はこのブラウザでは自動でその言語になる。
//
// このページは表示専用: 金額はサーバー (pos.orders) にロック済みの値をそのまま出すだけで、
// ブラウザ側からの改変経路を持たない (Tom「金額をブラウザ側から変更できないように」)。
//
// 「ABAで支払う」(2026-10-07 更新): PayWayのマーチャント登録 (会社登録が必要) がまだ無いため、
// 金額を自動で埋め込んだ動的QR・ABAアプリへの正式なディープリンクはどちらも作れない
// (PayWay公式ドキュメント上、どちらもマーチャント登録必須と確認済み)。暫定対応として、
// 店頭に貼ってある既存の静的ABA KHQR (金額なし、ABA_STATIC_KHQR_PAYLOAD) をそのまま
// このページにも表示し、お客様がABAアプリでスキャン→画面のTOTALを見ながら金額を手入力して
// 支払う形にする。「ABAアプリを開く」ボタンの abamobilebank:// は公式に未確認のベストエフォート
// (Tom実機確認済みの前提で有効化。動かなくてもQR表示は常に出ているのでフォールバックになる)。
type ReceiptOrder = {
  status: 'open' | 'awaiting_payment' | 'paid' | 'void';
  subtotal: number;
  vat: number;
  service: number;
  couponDiscount: number;
  orderDiscount: number;
  total: number;
  createdAt: string;
  paidAt: string | null;
};
type ReceiptItem = { name: string; qty: number; unitPrice: number; lineTotal: number };
type ReceiptData = {
  order: ReceiptOrder;
  items: ReceiptItem[];
  paymentMethod: string | null;
  storeName: string;
  abaStaticKhqr: string | null;
};

export function ReceiptApp({ token }: { token: string }) {
  return (
    <LanguageProvider storageKey={GUEST_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <ReceiptAppInner token={token} />
    </LanguageProvider>
  );
}

function ReceiptAppInner({ token }: { token: string }) {
  const { t, setLang } = useLanguage();
  const [languageChosen, setLanguageChosen] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setLanguageChosen(!!window.localStorage.getItem(GUEST_LANGUAGE_STORAGE_KEY));
    } catch {
      setLanguageChosen(false);
    }
  }, []);

  const [data, setData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abaQrDataUrl, setAbaQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (languageChosen === null || !languageChosen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/receipt/${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setError('notFound');
          return;
        }
        const json = (await res.json()) as ReceiptData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError('notFound');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, languageChosen]);

  useEffect(() => {
    if (!data?.abaStaticKhqr) return;
    let cancelled = false;
    QRCode.toDataURL(data.abaStaticKhqr, { width: 320, margin: 1 })
      .then((url: string) => {
        if (!cancelled) setAbaQrDataUrl(url);
      })
      .catch(() => {
        /* QR生成に失敗しても明細表示自体は継続する */
      });
    return () => {
      cancelled = true;
    };
  }, [data?.abaStaticKhqr]);

  if (languageChosen === null) return null;
  if (!languageChosen) {
    return (
      <LanguagePickerScreen
        onSelect={(l) => {
          setLang(l);
          setLanguageChosen(true);
        }}
      />
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <div className="text-[15px] font-bold text-muted-foreground">{t('receipt.notFound')}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <div className="text-[13px] text-muted-foreground">{t('receipt.loading')}</div>
      </div>
    );
  }

  const { order, items, paymentMethod, storeName } = data;
  const isPaid = order.status === 'paid';
  const isAwaiting = order.status === 'awaiting_payment';
  const createdAtLabel = new Date(order.createdAt).toLocaleString();

  if (!isPaid && !isAwaiting) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <div className="text-[15px] font-bold text-muted-foreground">{t('receipt.unavailable')}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-5 py-6">
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5">
        {isPaid && (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-center text-[15px] font-bold text-emerald-600">
            {t('receipt.paidBadge')} ✓
          </div>
        )}

        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-[18px] font-bold">{storeName}</div>
          <div className="text-[12px] text-muted-foreground">{createdAtLabel}</div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <div className="pb-1 text-[13px] font-bold text-muted-foreground">{t('receipt.itemsHeading')}</div>
          {items.map((it, idx) => (
            <div key={idx} className="flex items-start justify-between gap-3 text-[13.5px]">
              <div className="flex-1">
                <div className="font-semibold">{it.name}</div>
                <div className="text-[11.5px] text-muted-foreground">
                  {t('receipt.qty')} {it.qty} × ${money(it.unitPrice)}
                </div>
              </div>
              <div className="font-semibold">${money(it.lineTotal)}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-[13.5px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('receipt.subtotal')}</span>
            <span>${money(order.subtotal)}</span>
          </div>
          {order.vat > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('receipt.vat')}</span>
              <span>${money(order.vat)}</span>
            </div>
          )}
          {order.service > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('receipt.service')}</span>
              <span>${money(order.service)}</span>
            </div>
          )}
          {(order.couponDiscount > 0 || order.orderDiscount > 0) && (
            <div className="flex justify-between text-rose-600">
              <span>{t('receipt.discount')}</span>
              <span>-${money(order.couponDiscount + order.orderDiscount)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1 rounded-2xl bg-primary px-4 py-5 text-center text-primary-foreground">
          <div className="text-[13px] font-bold uppercase tracking-wide opacity-80">{t('receipt.total')}</div>
          <div className="text-[36px] font-extrabold leading-none">${money(order.total)}</div>
        </div>

        {isPaid && paymentMethod && (
          <div className="text-center text-[13px] text-muted-foreground">{t('receipt.paidWith', { method: paymentMethod })}</div>
        )}

        {isAwaiting && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-4">
            <div className="text-[14px] font-bold">{t('receipt.payWithAba')}</div>
            {data.abaStaticKhqr ? (
              <>
                <div className="text-center text-[12.5px] text-muted-foreground">
                  {t('receipt.scanWithAba', { total: `$${money(order.total)}` })}
                </div>
                {abaQrDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={abaQrDataUrl} alt="ABA KHQR" className="h-auto w-full max-w-[220px]" />
                )}
                <a
                  href="abamobilebank://"
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-primary text-[14.5px] font-bold text-primary-foreground active:opacity-90"
                >
                  {t('receipt.openAbaApp')}
                </a>
              </>
            ) : (
              <div className="text-center text-[12.5px] text-muted-foreground">{t('receipt.payComingSoon')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
