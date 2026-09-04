'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getPosOrderSettings } from '@/lib/pos-order-client';

// テーマカラー適用 (2026-09-02 追加)。Tom「画面イメージ色もカスタムできるようにしましょう！」
// への対応。設定画面 (一般設定タブ、POS単体運用モードのみ) で1色 (HEX) を選ぶと、/pos/* 全体の
// ボタン・アクセント色 (--primary / --brand の各CSS変数) がその色に置き換わる。未設定 (null) なら
// 何もせず、globals.css のデフォルト配色 (紺の --primary、赤の --brand) のまま。
//
// 2026-09-04 追加: 背景色 (backgroundColor) も同様にカスタムできるようにした
// (Tom「背景もカスタムできるようにしましょう」)。
// 最初のバージョンは --background だけを書き換えていたが、この画面のほとんどの面は
// bg-card (カード・パネル) で覆われているため、実際にはほぼ何も変わって見えなかった
// (Tom「背景が切り替わらない」)。そのため --card / --popover も同じ色に揃えて、選んだ色が
// 画面全体にちゃんと反映されるようにした。暗い色を選んだ場合に文字が読めなくならないよう、
// --foreground / --card-foreground / --popover-foreground も明度に応じて自動で白/濃紺に切り替える。
//
// 2026-09-04 追加 (その2): 「色が変わらない」の真因判明。この Injector は /pos/layout.tsx に
// 置いているため /pos/* 全体で1回しかマウントされない — 設定画面 (/pos/settings) で保存して
// 「戻る」で /pos に router.push() しても Next.js のクライアント側遷移では layout ごと
// 使い回されるため useEffect ([] 依存) が再実行されず、ブラウザを F5 で完全リロードしない限り
// 新しい色が反映されなかった。usePathname() を依存配列に加えて /pos/* 内を移動するたびに
// 設定を取り直すようにし、設定画面から戻ってきた瞬間に新しい色が効くようにした。
//
// 新規マイグレーション・APIは追加していない — 既存の pos.stores.settings (jsonb) に themeColor /
// backgroundColor を項目追加しただけで、レジ画面が起動時に必ず読む /api/pos-order/settings
// (認証なし公開API) に相乗りして配信している。

function hexToHsl(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// 明度からボタン文字を白/濃紺どちらにするか簡易判定 (明るい色なら濃色文字)。
function foregroundHslFor(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return '0 0% 100%';
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '222.2 47.4% 11.2%' : '0 0% 100%';
}

export function ThemeColorInjector() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    getPosOrderSettings()
      .then((s) => {
        if (cancelled) return;
        const root = document.documentElement.style;
        const hsl = s.themeColor ? hexToHsl(s.themeColor) : null;
        if (hsl && s.themeColor) {
          const fg = foregroundHslFor(s.themeColor);
          root.setProperty('--primary', hsl);
          root.setProperty('--primary-foreground', fg);
          root.setProperty('--brand', hsl);
          root.setProperty('--brand-foreground', fg);
        } else {
          root.removeProperty('--primary');
          root.removeProperty('--primary-foreground');
          root.removeProperty('--brand');
          root.removeProperty('--brand-foreground');
        }

        const bgHsl = s.backgroundColor ? hexToHsl(s.backgroundColor) : null;
        if (bgHsl && s.backgroundColor) {
          const bgFg = foregroundHslFor(s.backgroundColor);
          root.setProperty('--background', bgHsl);
          root.setProperty('--foreground', bgFg);
          root.setProperty('--card', bgHsl);
          root.setProperty('--card-foreground', bgFg);
          root.setProperty('--popover', bgHsl);
          root.setProperty('--popover-foreground', bgFg);
        } else {
          root.removeProperty('--background');
          root.removeProperty('--foreground');
          root.removeProperty('--card');
          root.removeProperty('--card-foreground');
          root.removeProperty('--popover');
          root.removeProperty('--popover-foreground');
        }
      })
      .catch(() => {
        // 取得失敗時はデフォルト配色のまま (画面表示自体は妨げない)。
      });
    return () => {
      cancelled = true;
    };
    // pathname を依存に入れることで、設定画面 (/pos/settings) で保存して /pos/* 内を
    // クライアント側遷移で移動するたびに最新の色を取り直す (詳細は上のコメント参照)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
