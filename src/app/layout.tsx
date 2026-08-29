import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "I'mHungry POS",
  description: 'Cambodia POS — matsunoya-dine 店内会計・注文管理システム',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
