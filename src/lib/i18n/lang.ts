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
