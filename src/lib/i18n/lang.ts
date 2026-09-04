// 多言語化 (2026-09-02 追加)。Tom「多言語化しましょう！日本語、英語、カンボジア語、中国語、韓国語が必要です」。
// UI表示言語。'ja' は常に基準言語 (フォールバック先) として扱う。

export type Lang = 'ja' | 'en' | 'km' | 'zh' | 'ko';

export const LANGS: Lang[] = ['ja', 'en', 'km', 'zh', 'ko'];

export const LANG_LABEL: Record<Lang, string> = {
  ja: '日本語',
  en: 'English',
  km: 'ខ្មែរ',
  zh: '中文',
  ko: '한국어',
};

export function isLang(value: string | null | undefined): value is Lang {
  return !!value && (LANGS as string[]).includes(value);
}

// toLocaleString() 等に渡す BCP-47 ロケール (2026-09-04 追加)。表示言語が日本語以外でも
// 日付・数値の書式が日本語のまま固定されていた箇所 (register-closing-screen.tsx 等) の
// 修正で導入。
export const LOCALE_FOR_LANG: Record<Lang, string> = {
  ja: 'ja-JP',
  en: 'en-US',
  km: 'km-KH',
  zh: 'zh-CN',
  ko: 'ko-KR',
};

export function localeForLang(lang: Lang): string {
  return LOCALE_FOR_LANG[lang] ?? 'ja-JP';
}
