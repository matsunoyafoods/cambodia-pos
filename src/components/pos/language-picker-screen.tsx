'use client';

import { LANGS, LANG_LABEL, type Lang } from '@/lib/i18n/lang';
import { useLanguage } from './language-context';

// 多言語化 (2026-09-02 追加)。QRセルフオーダー画面のみで使用。お客様がこのブラウザで
// 初めてQR注文画面にアクセスした時だけ表示し (Tom確認済み: 「最初にアクセスした時だけ選択画面を表示」)、
// 選択後は同じブラウザでは以降スキップされる (設定は端末=ブラウザ単位、テーブルをまたいで共有)。

export function LanguagePickerScreen({ onSelect }: { onSelect: (lang: Lang) => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 bg-background px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-[20px] font-bold text-brand-foreground">住</div>
      <div className="flex flex-col gap-1">
        <div className="text-base font-bold">{t('qr.languagePickerTitle')}</div>
        <div className="text-[12.5px] text-muted-foreground">{t('qr.languagePickerSubtitle')}</div>
      </div>
      <div className="flex w-full max-w-[320px] flex-col gap-2.5">
        {LANGS.map((l) => (
          <button
            key={l}
            onClick={() => onSelect(l)}
            className="h-14 rounded-xl border border-border bg-card text-[16px] font-bold text-foreground active:bg-secondary"
          >
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>
    </div>
  );
}
