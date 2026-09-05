'use client';

import { useEffect } from 'react';

// PWA化 (2026-09-05 追加。詳細は manifest.ts / public/sw.js のコメント参照)。
// ホーム画面に追加した際に「アドレスバー・タブバーなしの全画面アプリ」として
// 起動できるようにするため、素通しするだけの Service Worker を登録する。
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 登録に失敗しても通常のブラウザ表示として使えるため、エラーは握りつぶす
    });
  }, []);
  return null;
}
