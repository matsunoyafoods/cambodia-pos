import type { MetadataRoute } from 'next';

// PWA化 (2026-09-05 追加)。Tomからの要望「タブレットでシステムを開く時に、ブラウザの
// タブバーが見えないようにしたい (新しいタブを押すとGoogleの検索画面が出てしまう問題への
// 対策として)」への対応。この manifest とアイコンを用意した上で、タブレットのブラウザで
// 一度「ホーム画面に追加」してもらい、以降はそのホーム画面アイコンから起動することで、
// アドレスバーやタブバーが表示されない全画面 (display: 'standalone') の状態で開けるように
// なる。通常通りブラウザでURLを直接開いた場合は今まで通りタブ付きで表示される — この
// manifest はあくまで「ホーム画面に追加した場合の見た目」を変えるものであり、既存の
// ブラウザ利用には影響しない。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "I'mHungry POS",
    short_name: 'I\'mHungry POS',
    description: 'Cambodia POS — matsunoya-dine 店内会計・注文管理システム',
    start_url: '/',
    display: 'standalone',
    background_color: '#01236d',
    theme_color: '#01236d',
    orientation: 'landscape',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
