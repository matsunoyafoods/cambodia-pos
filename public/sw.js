// PWA化 (2026-09-05 追加) のための最小限の Service Worker。
//
// 目的はオフラインキャッシュではなく、あくまで「ホーム画面に追加」した時に Android の
// ブラウザが正式な PWA (アドレスバー・タブバーなしの standalone 起動) として認識する
// ためのインストール可否判定 (fetch イベントハンドラの存在) を満たすことだけ。
//
// このアプリはレジ・厨房のリアルタイムなデータを扱うため、注文や在庫のキャッシュは
// 絶対に行わない (今までにも fetch に cache: 'no-store' を明示的に付ける対応を各所で
// 行っている)。そのため、この Service Worker は全リクエストをそのままネットワークへ
// 素通しするだけで、独自のキャッシュ戦略は一切持たない。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
