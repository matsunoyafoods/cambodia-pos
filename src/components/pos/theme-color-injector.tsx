'use client';

import { useEffect } from 'react';
import { getPosOrderSettings } from '@/lib/pos-order-client';

// テーマカラー適用 (2026-09-02 追加)。Tom「画面イメージ色もカスタムできるようにしましょう！」
// への対応。設定画面 (一般設定タブ、POS単体運用モードのみ) で1色 (HEX) を選ぶと、/pos/* 全体の
// ボタン・アクセント色 (--primary / --brand の各CSS変数) がその色に置き換わる。未設定 (null) なら
// 何もせず、globals.css のデフォルト配色 (紺の --primary、赤の --brand) のまま。
//
// 新規マイグレーション・APIは追加していない — 既存の pos.stores.settings (jsonb) に themeColor
// を1項目追加しただけで、レジ画面が起動時に必ず読む /api/pos-order/settings (認証なし公開API)
// に相乗りして配信している。

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
      })
      .catch(() => {
        // 取得失敗時はデフォルト配色のまま (画面表示自体は妨げない)。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
