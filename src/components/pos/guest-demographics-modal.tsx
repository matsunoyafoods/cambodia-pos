'use client';

import { useState } from 'react';
import { ETHNICITY_KEYS, type EthnicityKey, type GuestEthnicity } from '@/lib/pos-types';
import { useLanguage } from './language-context';

// 多言語化 (2026-09-02 追加): 民族区分の表示名は pos-types.ts の ETHNICITY_LABELS (日本語固定、
// 売上レポートAPI等でも使われる共有定数) をそのまま使わず、この画面だけ t() 経由の翻訳に置き換える。
const ETHNICITY_LABEL_KEY: Record<EthnicityKey, string> = {
  khmer: 'guestDemo.ethnicityKhmer',
  japanese: 'guestDemo.ethnicityJapanese',
  chinese: 'guestDemo.ethnicityChinese',
  korean: 'guestDemo.ethnicityKorean',
  western: 'guestDemo.ethnicityWestern',
  other: 'guestDemo.ethnicityOther',
};

// レジ画面が「会計へ進む」を押した時 (まだ客層記録が済んでいない注文の場合) に必ず挟む
// 客層記録モーダル (2026-08-31 変更: 以前はファースト注文時だったが、「あとで人数が増えた
// 場合にも対応できる」「会計の時だと少し余裕がある」という理由でこのタイミングに移動した)。
// 人種構成の合計が1人以上でないと保存できない (キャンセルすれば注文画面に留まる。次に
// 「会計へ進む」を押せばまた同じモーダルが出る)。
export function GuestDemographicsModal({
  onCancel,
  onConfirm,
  submitting,
  error,
}: {
  onCancel: () => void;
  onConfirm: (ethnicity: GuestEthnicity, kidsCount: number) => void;
  submitting: boolean;
  error: string | null;
}) {
  const { t } = useLanguage();
  const [counts, setCounts] = useState<GuestEthnicity>({});
  const [kids, setKids] = useState(0);

  const total = ETHNICITY_KEYS.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const canSubmit = total > 0 && !submitting;

  function inc(key: (typeof ETHNICITY_KEYS)[number], delta: number) {
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) }));
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/45">
      <div className="flex max-h-[90vh] w-[440px] max-w-[92vw] flex-col gap-4 rounded-2xl bg-card p-5 shadow-2xl">
        <div>
          <div className="text-base font-bold">{t('guestDemo.title')}</div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">{t('guestDemo.subtitle')}</div>
        </div>

        <div className="flex flex-col gap-2 overflow-auto">
          {ETHNICITY_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div className="text-[13px] font-semibold">{t(ETHNICITY_LABEL_KEY[key])}</div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => inc(key, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
                >
                  −
                </button>
                <div className="w-6 text-center text-[13px] font-semibold">{counts[key] ?? 0}</div>
                <button
                  type="button"
                  onClick={() => inc(key, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
                >
                  ＋
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2">
            <div className="text-[13px] font-semibold">{t('guestDemo.kidsCount')}</div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setKids((v) => Math.max(0, v - 1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
              >
                −
              </button>
              <div className="w-6 text-center text-[13px] font-semibold">{kids}</div>
              <button
                type="button"
                onClick={() => setKids((v) => v + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
              >
                ＋
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-border pt-2 text-[12px] text-muted-foreground">
          <span>{t('guestDemo.totalLabel')}</span>
          <span className="font-bold text-foreground">{t('guestDemo.totalCount', { count: total })}</span>
        </div>
        {total === 0 && <div className="text-[11px] text-destructive">{t('guestDemo.selectAtLeastOne')}</div>}
        {error && <div className="text-[11px] text-destructive">{error}</div>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 flex-1 rounded-lg border border-border text-sm font-semibold"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm(counts, kids)}
            className={
              'h-11 flex-1 rounded-lg text-sm font-bold ' +
              (canSubmit ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')
            }
          >
            {submitting ? t('guestDemo.saving') : t('guestDemo.saveAndProceed')}
          </button>
        </div>
      </div>
    </div>
  );
}
