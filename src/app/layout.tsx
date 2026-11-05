import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRegister } from '@/components/pwa-register';

export const metadata: Metadata = {
  // 2026-11-05: タブ名が「I'mHungry POS」(松之屋フーズ自社ブランド名) のままだったのを、
  // 他店舗にも販売する多店舗対応製品として汎用的な「Cambodia POS」に変更 (Tom指摘)。
  title: 'Cambodia POS',
  description: 'Cambodia POS — 店内会計・注文管理システム',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cambodia POS',
  },
};

export const viewport: Viewport = {
  themeColor: '#01236d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
