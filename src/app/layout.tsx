import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRegister } from '@/components/pwa-register';

export const metadata: Metadata = {
  title: "I'mHungry POS",
  description: 'Cambodia POS — matsunoya-dine 店内会計・注文管理システム',
  // PWA化 (2026-09-05 追加。詳細は manifest.ts のコメント参照)。ホーム画面に追加した際に
  // iOS/Android で「アプリらしく」ステータスバー等が馴染むようにする設定。
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: "I'mHungry POS",
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
