'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LANGS, isLang, type Lang } from '@/lib/i18n/lang';
import { DICTIONARY } from '@/lib/i18n/dictionary';
import type { TranslationMap } from '@/lib/pos-types';

// 多言語化 (2026-09-02 追加)。QRセルフオーダー(お客様)・ハンディ/レジ(スタッフ)の両方で
// 共通利用する言語コンテキスト。localStorageのキーを分けているのは、お客様のブラウザ選択が
// 誤ってスタッフ端末の表示言語に影響しない (=共有端末での意図しない言語切り替え事故を防ぐ) ため。

export const GUEST_LANGUAGE_STORAGE_KEY = 'cambodiaPosGuestLanguage';
export const STAFF_LANGUAGE_STORAGE_KEY = 'cambodiaPosStaffLanguage';

type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** UI文言の翻訳。{変数名} はvarsで置換。訳が無い言語は日本語にフォールバック。 */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** メニュー・カテゴリー・オプション名の翻訳 (pos.menu_* の translations 列由来)。
   * 現在の言語がjaの場合、または対象の言語に翻訳が無い場合は日本語 (ja) にフォールバックする。 */
  menuText: (ja: string, translations?: TranslationMap | null) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readStoredLang(storageKey: string): Lang | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(storageKey);
    return isLang(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function LanguageProvider({
  children,
  storageKey,
  defaultLang = 'ja',
}: {
  children: React.ReactNode;
  /** localStorageのキー。省略時は永続化しない (常にdefaultLangから開始)。 */
  storageKey?: string;
  defaultLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(defaultLang);

  useEffect(() => {
    if (!storageKey) return;
    const saved = readStoredLang(storageKey);
    if (saved) setLangState(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // localStorageが使えない環境でも表示自体は継続する
      }
    },
    [storageKey],
  );

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTIONARY[lang] ?? DICTIONARY.ja;
      let text = dict[key] ?? DICTIONARY.ja[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [lang],
  );

  const menuText = useCallback(
    (ja: string, translations?: TranslationMap | null) => {
      if (lang === 'ja' || !translations) return ja;
      const value = translations[lang as Exclude<Lang, 'ja'>];
      return value && value.trim() ? value : ja;
    },
    [lang],
  );

  return <LanguageContext.Provider value={{ lang, setLang, t, menuText }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Provider外で使われた場合も画面を壊さないよう、日本語固定のフォールバックを返す
    // (開発中の配線漏れの検知はコンソール警告で行う)。
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('useLanguage() called outside LanguageProvider — falling back to ja');
    }
    return {
      lang: 'ja',
      setLang: () => {},
      t: (key) => DICTIONARY.ja[key] ?? key,
      menuText: (ja) => ja,
    };
  }
  return ctx;
}

export { LANGS };
export type { Lang };
