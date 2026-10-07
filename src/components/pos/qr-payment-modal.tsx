'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useLanguage } from './language-context';

// 会計画面の「QRで会計 (ABA)」モーダル (2026-10-06 追加。QR+ABA決済フロー フェーズ1)。
// qr-codes-screen.tsx と同じ方針で、QRコードはブラウザ側で `qrcode` ライブラリを使って
// その場で生成する (外部の画像生成APIに依存しない)。QRは `/receipt/{token}` を指す —
// 注文情報そのものはQRに埋め込まない (Tom「QRコードには注文情報そのものを埋め込まず、
// 推測困難なトークン等を使った安全なURLを」への対応)。
export function QrPaymentModal({ token, onClose }: { token: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const origin = window.location.origin;
        const url = await QRCode.toDataURL(`${origin}/receipt/${encodeURIComponent(token)}`, { width: 420, margin: 1 });
        if (!cancelled) setDataUrl(url);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-2xl bg-card p-6 text-center">
        <div className="text-[18px] font-bold">{t('checkout.qrModalTitle')}</div>
        <div className="text-[13px] text-muted-foreground">{t('checkout.qrModalInstruction')}</div>
        {error && <div className="text-[13px] text-destructive">{t('checkout.qrError')}</div>}
        {!error && !dataUrl && <div className="py-10 text-[13px] text-muted-foreground">{t('checkout.qrGenerating')}</div>}
        {dataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="QR" className="h-auto w-full max-w-[280px]" />
        )}
        <button
          onClick={onClose}
          className="h-11 w-full rounded-lg border border-border bg-secondary text-[14px] font-bold text-foreground"
        >
          {t('checkout.qrModalClose')}
        </button>
      </div>
    </div>
  );
}
