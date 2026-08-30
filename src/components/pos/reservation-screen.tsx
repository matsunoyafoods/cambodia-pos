'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelReservation,
  createReservation,
  getReservations,
  ReservationApiError,
  type ReservationRecord,
  type ReservationType,
} from '@/lib/reservation-client';

const TYPE_LABEL: Record<ReservationType, string> = {
  normal: '通常予約',
  tenderloin_block: '誕生日テンダーロインブロック予約',
  birthday_room: '個室予約(バースデー等)',
  group: '団体予約',
};

const TYPE_DESC: Record<ReservationType, string> = {
  normal: 'いつも通りのご来店予約',
  tenderloin_block: 'ブロック肉のご注文(前日までの予約制)',
  birthday_room: '無料特典の個室利用(1日前までの予約制)',
  group: '人数ベースの会食・宴会(事前予約制・当日不可)',
};

type StepField =
  | { kind: 'text'; key: string; placeholder?: string; required?: boolean }
  | { kind: 'tel'; key: string; placeholder?: string; required?: boolean }
  | { kind: 'number'; key: string; min?: number; max?: number; placeholder?: string; required?: boolean }
  | { kind: 'date'; key: string; required?: boolean }
  | { kind: 'time'; key: string; required?: boolean }
  | { kind: 'select'; key: string; options: { value: string; label: string }[]; required?: boolean }
  | { kind: 'textarea'; key: string; required?: boolean };

type Step = {
  id: string;
  script: string; // お客様への声かけ文言 (このままお読みください)
  note?: string; // スタッフ向けの注意事項 (声かけ文言ではない)
  field: StepField;
};

function buildSteps(type: ReservationType): Step[] {
  const common: Step[] = [
    {
      id: 'customerName',
      script: 'お電話ありがとうございます。I\'mHungryでございます。ご予約のお名前を頂戴できますでしょうか？',
      field: { kind: 'text', key: 'customerName', placeholder: '例: 田中様', required: true },
    },
    {
      id: 'phone',
      script: 'ありがとうございます。念のため、当日ご連絡が取れるお電話番号を教えていただけますか？',
      field: { kind: 'tel', key: 'phone', placeholder: '例: 012-345-678' },
    },
    {
      id: 'partySize',
      script: 'ご来店の人数は何名様でしょうか？',
      field: { kind: 'number', key: 'partySize', min: 1, max: 500, required: true },
    },
  ];

  const dateStep: Step =
    type === 'tenderloin_block'
      ? {
          id: 'reservationDate',
          script:
            'ご来店希望の日付を教えてください。なお、こちらの商品は前日までのご予約が必要となりますので、あらかじめご了承ください。',
          note: '⚠ 前日までの予約制。当日希望の場合はお受けできない旨を必ず伝える。',
          field: { kind: 'date', key: 'reservationDate', required: true },
        }
      : type === 'birthday_room'
        ? {
            id: 'reservationDate',
            script:
              'ご来店希望の日付を教えてください。こちらの個室特典は、1日前までのご予約制となっております。',
            note: '⚠ 1日前までの予約制。',
            field: { kind: 'date', key: 'reservationDate', required: true },
          }
        : type === 'group'
          ? {
              id: 'reservationDate',
              script:
                'ご来店希望の日付を教えてください。団体でのご予約は、当日のお申し込みはお受けできかねます。前日までにご連絡いただけますと幸いです。',
              note: '⚠ 当日予約不可。事前予約のみ。',
              field: { kind: 'date', key: 'reservationDate', required: true },
            }
          : {
              id: 'reservationDate',
              script: 'ご来店希望の日付を教えてください。',
              field: { kind: 'date', key: 'reservationDate', required: true },
            };

  const timeStep: Step = {
    id: 'reservationTime',
    script: 'ご来店のお時間は何時頃をご希望でしょうか？',
    field: { kind: 'time', key: 'reservationTime' },
  };

  const typeSpecific: Step[] =
    type === 'tenderloin_block'
      ? [
          {
            id: 'cut',
            script:
              'テンダーロインブロックは、テンダーロインステーキ(オーストラリア産)と、USプレミアムテンダーロインの2種類がございます。どちらになさいますか？',
            field: {
              kind: 'select',
              key: 'cut',
              required: true,
              options: [
                { value: 'AU', label: 'テンダーロインステーキ(オーストラリア産)' },
                { value: 'US', label: 'US プレミアムテンダーロイン' },
              ],
            },
          },
          {
            id: 'weight',
            script: 'グラム数は1000gと1500gからお選びいただけます。どちらになさいますか？',
            field: {
              kind: 'select',
              key: 'weight',
              required: true,
              options: [
                { value: '1000g', label: '1000g' },
                { value: '1500g', label: '1500g' },
              ],
            },
          },
        ]
      : type === 'birthday_room'
        ? [
            {
              id: 'occasion',
              script: '本日はどのようなお祝い事でのご利用でしょうか？(お誕生日など)',
              field: { kind: 'text', key: 'occasion', placeholder: '例: 奥様のお誕生日' },
            },
            {
              id: 'decoration_request',
              script: 'お部屋の飾り付けにご希望はございますか？ご予算に応じて対応させていただきます。',
              field: { kind: 'text', key: 'decoration_request', placeholder: '例: 風船・お花など' },
            },
          ]
        : type === 'group'
          ? [
              {
                id: 'budget_per_person',
                script:
                  'お一人様あたりのご予算はおいくらくらいでお考えでしょうか？1名様$20〜のプランをご用意しております。',
                field: { kind: 'number', key: 'budget_per_person', min: 1, max: 1000 },
              },
              {
                id: 'purpose',
                script: 'どのようなお集まりでのご利用でしょうか？(歓送迎会・宴会など)',
                field: { kind: 'text', key: 'purpose', placeholder: '例: 会社の歓送迎会' },
              },
            ]
          : [
              {
                id: 'seating_request',
                script: 'お座席のご希望はございますか？(お座敷・テーブル席など)',
                field: { kind: 'text', key: 'seating_request', placeholder: '任意' },
              },
            ];

  const notesStep: Step = {
    id: 'notes',
    script: '最後に、アレルギーやその他ご要望がございましたら教えてください。',
    field: { kind: 'textarea', key: 'notes' },
  };

  return [...common, dateStep, timeStep, ...typeSpecific, notesStep];
}

const DETAIL_KEYS = ['cut', 'weight', 'occasion', 'decoration_request', 'budget_per_person', 'purpose', 'seating_request'];

export function ReservationScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'list' | 'select-type' | 'wizard' | 'done'>('list');
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [type, setType] = useState<ReservationType>('normal');
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function loadList() {
    setListLoading(true);
    setListError(null);
    getReservations()
      .then(({ items }) => setReservations(items))
      .catch((err) => setListError(err instanceof ReservationApiError ? err.message : '予約一覧の取得に失敗しました'))
      .finally(() => setListLoading(false));
  }

  useEffect(() => {
    if (mode === 'list') loadList();
  }, [mode]);

  function startNew() {
    setAnswers({});
    setStepIndex(0);
    setSubmitError(null);
    setMode('select-type');
  }

  function pickType(t: ReservationType) {
    setType(t);
    setStepIndex(0);
    setAnswers({});
    setMode('wizard');
  }

  const steps = buildSteps(type);
  const isSummary = stepIndex >= steps.length;
  const step = !isSummary ? steps[stepIndex] : null;

  function currentValue(): string {
    if (!step) return '';
    return answers[step.field.key] ?? '';
  }

  function setValue(v: string) {
    if (!step) return;
    setAnswers((prev) => ({ ...prev, [step.field.key]: v }));
  }

  function canProceed(): boolean {
    if (!step) return true;
    const required = 'required' in step.field ? !!step.field.required : false;
    if (!required) return true;
    return currentValue().trim().length > 0;
  }

  async function handleConfirm() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const details: Record<string, string> = {};
      for (const k of DETAIL_KEYS) {
        if (answers[k]) details[k] = answers[k];
      }
      await createReservation({
        reservationType: type,
        customerName: answers.customerName ?? '',
        phone: answers.phone || undefined,
        partySize: answers.partySize ? parseInt(answers.partySize, 10) : undefined,
        reservationDate: answers.reservationDate ?? '',
        reservationTime: answers.reservationTime || undefined,
        details,
        notes: answers.notes || undefined,
      });
      setMode('done');
    } catch (err) {
      setSubmitError(err instanceof ReservationApiError ? err.message : '予約の保存に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancelReservation(id);
      loadList();
    } catch {
      /* 一覧再取得で状態を確認できるので、ここでは静かに失敗させる */
    }
  }

  return (
    <div className="flex h-[800px] w-[1280px] flex-col overflow-hidden bg-background">
      <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (mode === 'list' ? router.push('/pos') : setMode('list'))}
            className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-secondary"
          >
            ← {mode === 'list' ? '戻る' : '予約一覧へ'}
          </button>
          <div>
            <div className="text-base font-bold">予約受付</div>
            <div className="text-xs text-muted-foreground">
              電話予約を、画面の質問(声かけ文言つき)に沿って受け付けます
            </div>
          </div>
        </div>
        {mode === 'list' && (
          <button
            onClick={startNew}
            className="h-10 rounded-lg bg-primary px-4.5 text-[13.5px] font-bold text-primary-foreground"
          >
            + 新規予約を受け付ける
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {mode === 'list' && (
          <div className="flex flex-col gap-3">
            {listLoading && <div className="text-sm text-muted-foreground">読み込み中…</div>}
            {listError && <div className="text-sm text-destructive">{listError}</div>}
            {!listLoading && !listError && reservations.length === 0 && (
              <div className="rounded-xl border border-border p-5 text-center text-sm text-muted-foreground">
                予約はまだありません
              </div>
            )}
            {reservations.map((r) => (
              <div
                key={r.id}
                className={
                  'flex items-center justify-between rounded-xl border p-4 ' +
                  (r.status === 'cancelled' ? 'border-border bg-secondary/40 opacity-60' : 'border-border bg-card')
                }
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold">
                      {TYPE_LABEL[r.reservationType]}
                    </span>
                    {r.status === 'cancelled' && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold text-destructive">
                        キャンセル済み
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[14px] font-bold">
                    {r.reservationDate} {r.reservationTime ?? ''} ・ {r.customerName}様
                    {r.partySize ? ` ・ ${r.partySize}名` : ''}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {r.phone ? `TEL ${r.phone} ・ ` : ''}
                    受付: {r.createdByName ?? '-'}
                    {r.notes ? ` ・ 備考: ${r.notes}` : ''}
                  </div>
                </div>
                {r.status === 'confirmed' && (
                  <button
                    onClick={() => handleCancel(r.id)}
                    className="h-9 rounded-lg border border-destructive px-3.5 text-[12px] font-semibold text-destructive"
                  >
                    キャンセルにする
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'select-type' && (
          <div className="mx-auto flex max-w-[640px] flex-col gap-3">
            <div className="text-[15px] font-bold">どの予約を受け付けますか？</div>
            {(Object.keys(TYPE_LABEL) as ReservationType[]).map((t) => (
              <button
                key={t}
                onClick={() => pickType(t)}
                className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary"
              >
                <div className="text-[14px] font-bold">{TYPE_LABEL[t]}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">{TYPE_DESC[t]}</div>
              </button>
            ))}
          </div>
        )}

        {mode === 'wizard' && step && (
          <div className="mx-auto flex max-w-[560px] flex-col gap-4">
            <div className="text-[11.5px] font-semibold text-muted-foreground">
              {TYPE_LABEL[type]} ・ {stepIndex + 1} / {steps.length + 1}
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-[11px] font-semibold text-primary">お客様への声かけ</div>
              <div className="mt-1 text-[14px] leading-relaxed">「{step.script}」</div>
            </div>
            {step.note && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-800">
                {step.note}
              </div>
            )}

            <StepInput field={step.field} value={currentValue()} onChange={setValue} />

            <div className="mt-2 flex justify-between">
              <button
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                disabled={stepIndex === 0}
                className="h-11 rounded-lg border border-border px-5 text-[13px] font-semibold disabled:opacity-40"
              >
                戻る
              </button>
              <button
                onClick={() => setStepIndex((i) => i + 1)}
                disabled={!canProceed()}
                className="h-11 rounded-lg bg-primary px-6 text-[13px] font-bold text-primary-foreground disabled:opacity-40"
              >
                次へ
              </button>
            </div>
          </div>
        )}

        {mode === 'wizard' && isSummary && (
          <div className="mx-auto flex max-w-[560px] flex-col gap-4">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-[11px] font-semibold text-primary">お客様への声かけ</div>
              <div className="mt-1 text-[14px] leading-relaxed">
                「ご予約内容を確認させていただきます。{answers.customerName}様、
                {answers.partySize ? `${answers.partySize}名様、` : ''}
                {answers.reservationDate}
                {answers.reservationTime ? ` ${answers.reservationTime}` : ''}
                のご予約で承りました。以上でお間違いございませんでしょうか？」
              </div>
            </div>
            <div className="rounded-xl border border-border p-4 text-[12.5px] leading-relaxed">
              <div className="font-bold">{TYPE_LABEL[type]}</div>
              <div className="mt-2 grid grid-cols-2 gap-y-1.5">
                <div className="text-muted-foreground">お名前</div>
                <div>{answers.customerName || '-'}</div>
                <div className="text-muted-foreground">電話番号</div>
                <div>{answers.phone || '-'}</div>
                <div className="text-muted-foreground">人数</div>
                <div>{answers.partySize ? `${answers.partySize}名` : '-'}</div>
                <div className="text-muted-foreground">日付・時間</div>
                <div>
                  {answers.reservationDate || '-'} {answers.reservationTime || ''}
                </div>
                {DETAIL_KEYS.filter((k) => answers[k]).map((k) => (
                  <Fragment key={k}>
                    <div className="text-muted-foreground">{k}</div>
                    <div>{answers[k]}</div>
                  </Fragment>
                ))}
                <div className="text-muted-foreground">備考</div>
                <div>{answers.notes || '-'}</div>
              </div>
            </div>
            {submitError && <div className="text-[12.5px] text-destructive">{submitError}</div>}
            <div className="mt-1 flex justify-between">
              <button
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="h-11 rounded-lg border border-border px-5 text-[13px] font-semibold"
              >
                戻る
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="h-11 rounded-lg bg-primary px-6 text-[13px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {submitting ? '保存中…' : '予約を確定する'}
              </button>
            </div>
          </div>
        )}

        {mode === 'done' && (
          <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 pt-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
              ✓
            </div>
            <div className="text-[15px] font-bold">予約を受け付けました</div>
            <div className="text-[12.5px] text-muted-foreground">
              「お電話ありがとうございました。{answers.customerName}様のご来店を心よりお待ちしております。」
            </div>
            <div className="mt-2 flex gap-3">
              <button
                onClick={startNew}
                className="h-11 rounded-lg border border-border px-5 text-[13px] font-semibold"
              >
                続けて予約を受け付ける
              </button>
              <button
                onClick={() => setMode('list')}
                className="h-11 rounded-lg bg-primary px-5 text-[13px] font-bold text-primary-foreground"
              >
                予約一覧へ戻る
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepInput({
  field,
  value,
  onChange,
}: {
  field: StepField;
  value: string;
  onChange: (v: string) => void;
}) {
  const base = 'h-12 w-full rounded-lg border border-border px-3.5 text-[14px]';
  if (field.kind === 'select') {
    return (
      <div className="flex flex-col gap-2">
        {field.options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={
              'rounded-lg border px-4 py-3 text-left text-[13.5px] font-semibold ' +
              (value === o.value ? 'border-primary bg-primary/10' : 'border-border bg-card')
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (field.kind === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={base + ' resize-none py-3'}
      />
    );
  }
  return (
    <input
      type={field.kind}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={'placeholder' in field ? field.placeholder : undefined}
      min={'min' in field ? field.min : undefined}
      max={'max' in field ? field.max : undefined}
      className={base}
    />
  );
}
