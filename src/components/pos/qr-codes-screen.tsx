'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useRouter } from 'next/navigation';
import { listTableLayout, type TableLayoutItemRecord } from '@/lib/table-layout-client';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// 卓ごとのQRコード印刷画面 (2026-08-31 追加。「QRコードを読み込んでセルフオーダーもできる
// ようにしたい」への対応)。各卓のQRコードは `<本番URL>/order/<卓コード>` を指す
// (src/app/order/[tableCode]/page.tsx、認証なしの公開ページ。qr-order-app.tsx 参照)。
// QRコードはブラウザ側で `qrcode` ライブラリを使ってその場で生成する (外部の画像生成APIに
// 依存しない。ネットワーク不調時や第三者サービス停止時の印刷トラブルを避けるため)。

type QrTile = { code: string; seats: number; dataUrl: string };

export function QrCodesScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <QrCodesScreenInner />
    </LanguageProvider>
  );
}

function QrCodesScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const [tiles, setTiles] = useState<QrTile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { items } = await listTableLayout();
        const tables = (items as TableLayoutItemRecord[])
          .filter((tbl) => tbl.kind === 'table')
          .sort((a, b) => a.table_code.localeCompare(b.table_code, undefined, { numeric: true }));
        const origin = window.location.origin;
        const generated = await Promise.all(
          tables.map(async (tbl) => ({
            code: tbl.table_code,
            seats: tbl.seats,
            dataUrl: await QRCode.toDataURL(`${origin}/order/${encodeURIComponent(tbl.table_code)}`, { width: 320, margin: 1 }),
          })),
        );
        if (cancelled) return;
        setTiles(generated);
      } catch {
        if (cancelled) return;
        setError(t('qrCodes.loadError'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-3 print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
            ← {t('common.backToRegister')}
          </button>
          <div className="text-[15px] font-bold">{t('qrCodes.title')}</div>
        </div>
        {tiles && tiles.length > 0 && (
          <button onClick={() => window.print()} className="h-9 rounded-lg bg-primary px-4 text-[13px] font-bold text-primary-foreground">
            {t('qrCodes.printButton')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {error && <div className="text-[13px] text-destructive">{error}</div>}
        {!error && !tiles && <div className="text-[13px] text-muted-foreground">{t('qrCodes.generating')}</div>}
        {tiles && tiles.length === 0 && (
          <div className="text-[13px] text-muted-foreground">{t('qrCodes.noTables')}</div>
        )}
        {tiles && tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 print:grid-cols-3">
            {tiles.map((tile) => (
              <div
                key={tile.code}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center print:break-inside-avoid print:border-black"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tile.dataUrl} alt={t('qrCodes.qrAlt', { code: tile.code })} className="h-auto w-full max-w-[220px]" />
                <div className="text-[15px] font-bold">{t('qrCodes.tableLabel', { code: tile.code })}</div>
                <div className="text-[11px] text-muted-foreground">{t('qrCodes.seatsCount', { count: tile.seats })}</div>
                <div className="text-[10px] text-muted-foreground">{t('qrCodes.scanInstruction')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
