'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  assignReservationTables,
  cancelReservation,
  createReservation,
  getReservations,
  ReservationApiError,
  type ReservationRecord,
  type ReservationType,
} from '@/lib/reservation-client';
import { listTableLayout } from '@/lib/table-layout-client';
import { DEMO_TABLES } from '@/lib/demo-data';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

type TFunc = ReturnType<typeof useLanguage>['t'];

function typeLabel(type: ReservationType, t: TFunc): string {
  return t(`reservation.typeLabel.${type}`);
}

function typeDesc(type: ReservationType, t: TFunc): string {
  return t(`reservation.typeDesc.${type}`);
}

const RESERVATION_TYPES: ReservationType[] = ['normal', 'tenderloin_block', 'birthday_room', 'group'];

type StepField =
  | { kind: 'text'; key: string; placeholder?: string; required?: boolean }
  | { kind: 'tel'; key: string; placeholder?: string; required?: boolean }
  | { kind: 'number'; key: string; min?: number; max?: number; placeholder?: string; required?: boolean }
  | { kind: 'date'; key: string; required?: boolean }
  | { kind: 'time'; key: string; required?: boolean }
  | { kind: 'select'; key: string; options: { value: string; label: string }[]; required?: boolean }
  | { kind: 'textarea'; key: string; required?: boolean }
  // 電話を受けた時点ではまだ「どの予約種類か」がわからないため、種類選択は通常の質問より後
  // (基本情報を全て聞き終えた最後) に置く専用ステップ。声かけ文言は無く、スタッフがその場で
  // 分類するだけの内部ステップ (2026-08-31 追加。Tomさんの要望「電話に出る時はまだどの
  // カテゴリーかわからないので、選択は電話で聞くの最後に出して欲しい」)。
  | { kind: 'type-select' };

type Step = {
  id: string;
  script?: string; // お客様への声かけ文言 (このままお読みください)。type-select ステップには無い
  note?: string; // スタッフ向けの注意事項 (声かけ文言ではない)
  field: StepField;
};

// 共通の基本情報。電話を取った直後、まだ予約の種類がわからない段階で聞ける質問だけをここに
// 置く (お名前・電話番号・人数・来店日・時間・備考)。種類ごとに文言を出し分けていた来店日の
// 「前日までの予約制です」等の案内は、種類がわかった後 (typeSpecificSteps) に移動した。
function buildCommonSteps(t: TFunc): Step[] {
  return [
    {
      id: 'customerName',
      script: t('reservation.step.customerName.script'),
      field: { kind: 'text', key: 'customerName', placeholder: t('reservation.step.customerName.placeholder'), required: true },
    },
    {
      id: 'phone',
      script: t('reservation.step.phone.script'),
      field: { kind: 'tel', key: 'phone', placeholder: t('reservation.step.phone.placeholder') },
    },
    {
      id: 'partySize',
      script: t('reservation.step.partySize.script'),
      field: { kind: 'number', key: 'partySize', min: 1, max: 500, required: true },
    },
    {
      id: 'reservationDate',
      script: t('reservation.step.reservationDate.script'),
      field: { kind: 'date', key: 'reservationDate', required: true },
    },
    {
      id: 'reservationTime',
      script: t('reservation.step.reservationTime.script'),
      field: { kind: 'time', key: 'reservationTime' },
    },
    {
      id: 'notes',
      script: t('reservation.step.notes.script'),
      field: { kind: 'textarea', key: 'notes' },
    },
  ];
}

const TYPE_SELECT_STEP: Step = { id: 'reservationType', field: { kind: 'type-select' } };

// 予約の種類がわかった後だけ聞く追加質問。前日までの予約制などの案内は、既に伺った来店日
// (reservationDate) を踏まえてこの時点で確認する形にした (以前は来店日を聞く時点で種類ごとに
// 文言を出し分けていたが、種類選択がその質問より後になったため)。
function typeSpecificSteps(type: ReservationType, reservationDate: string, t: TFunc): Step[] {
  const dateLabel = reservationDate || t('reservation.notEntered');
  switch (type) {
    case 'tenderloin_block':
      return [
        {
          id: 'cut',
          script: t('reservation.step.tenderloin.cutScript'),
          note: t('reservation.step.tenderloin.cutNote', { date: dateLabel }),
          field: {
            kind: 'select',
            key: 'cut',
            required: true,
            options: [
              { value: 'AU', label: t('reservation.option.cutAu') },
              { value: 'US', label: t('reservation.option.cutUs') },
            ],
          },
        },
        {
          id: 'weight',
          script: t('reservation.step.tenderloin.weightScript'),
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
      ];
    case 'birthday_room':
      return [
        {
          id: 'occasion',
          script: t('reservation.step.birthday.occasionScript'),
          note: t('reservation.step.birthday.occasionNote', { date: dateLabel }),
          field: { kind: 'text', key: 'occasion', placeholder: t('reservation.step.birthday.occasionPlaceholder') },
        },
        {
          id: 'decoration_request',
          script: t('reservation.step.birthday.decorationScript'),
          field: { kind: 'text', key: 'decoration_request', placeholder: t('reservation.step.birthday.decorationPlaceholder') },
        },
      ];
    case 'group':
      return [
        {
          id: 'budget_per_person',
          script: t('reservation.step.group.budgetScript'),
          note: t('reservation.step.group.budgetNote', { date: dateLabel }),
          field: { kind: 'number', key: 'budget_per_person', min: 1, max: 1000 },
        },
        {
          id: 'purpose',
          script: t('reservation.step.group.purposeScript'),
          field: { kind: 'text', key: 'purpose', placeholder: t('reservation.step.group.purposePlaceholder') },
        },
      ];
    default:
      return [
        {
          id: 'seating_request',
          script: t('reservation.step.default.seatingScript'),
          field: { kind: 'text', key: 'seating_request', placeholder: t('reservation.step.default.seatingPlaceholder') },
        },
      ];
  }
}

// ウィザード全体のステップ列。type がまだ null (種類未選択) の間は「基本情報 + 種類選択」まで、
// 種類が決まったら種類別の追加質問が続く (buildSteps 呼び出し側で type を都度渡す)。
function buildSteps(type: ReservationType | null, reservationDate: string, t: TFunc): Step[] {
  const common = buildCommonSteps(t);
  if (!type) return [...common, TYPE_SELECT_STEP];
  return [...common, TYPE_SELECT_STEP, ...typeSpecificSteps(type, reservationDate, t)];
}

const DETAIL_KEYS = ['cut', 'weight', 'occasion', 'decoration_request', 'budget_per_person', 'purpose', 'seating_request'];

function detailLabel(key: string, t: TFunc): string {
  return t(`reservation.detailLabel.${key}`);
}

export function ReservationScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <ReservationScreenInner />
    </LanguageProvider>
  );
}

function ReservationScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const [mode, setMode] = useState<'list' | 'wizard' | 'done'>('list');
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // 卓割り当て (2026-09-02 追加)。予約一覧の各行から「どの卓を使うか」を設定できるようにする。
  // 選択肢は設定画面のテーブルレイアウトから取得し、まだ何も配置していない店舗はテーブルマップと
  // 同じサンプル卓一覧 (DEMO_TABLES) にフォールバックする。
  const [tableOptions, setTableOptions] = useState<{ code: string; seats: number }[]>([]);
  const [editingTablesId, setEditingTablesId] = useState<string | null>(null);
  const [editingTableCodes, setEditingTableCodes] = useState<string[]>([]);
  const [tableSaving, setTableSaving] = useState(false);
  const [tableSaveError, setTableSaveError] = useState<string | null>(null);

  useEffect(() => {
    listTableLayout()
      .then(({ items }) => {
        const tables = items.filter((tbl) => tbl.kind === 'table').map((tbl) => ({ code: tbl.table_code, seats: tbl.seats }));
        setTableOptions(tables.length > 0 ? tables : DEMO_TABLES.map((tbl) => ({ code: tbl.code, seats: tbl.seats })));
      })
      .catch(() => setTableOptions(DEMO_TABLES.map((tbl) => ({ code: tbl.code, seats: tbl.seats }))));
  }, []);

  // 電話を取った時点では種類がわからないため、初期値は未選択 (null)。基本情報を聞き終えた
  // 最後のステップ (TYPE_SELECT_STEP) でスタッフが選択するまで null のまま。
  const [type, setType] = useState<ReservationType | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function loadList() {
    setListLoading(true);
    setListError(null);
    getReservations()
      .then(({ items }) => setReservations(items))
      .catch((err) => setListError(err instanceof ReservationApiError ? err.message : t('reservation.listLoadError')))
      .finally(() => setListLoading(false));
  }

  useEffect(() => {
    if (mode === 'list') loadList();
  }, [mode]);

  function startNew() {
    setAnswers({});
    setStepIndex(0);
    setSubmitError(null);
    setType(null);
    setMode('wizard');
  }

  // 種類選択ステップでボタンを押した瞬間に type を確定し、次のステップへ進む
  // (他の選択肢と違い「次へ」を別途押させない — 元の「種類選択→即ウィザード開始」の操作感を踏襲)。
  function chooseType(newType: ReservationType) {
    setType(newType);
    setStepIndex((i) => i + 1);
  }

  const steps = buildSteps(type, answers.reservationDate ?? '', t);
  const isSummary = stepIndex >= steps.length;
  const step = !isSummary ? steps[stepIndex] : null;

  function currentValue(): string {
    if (!step || step.field.kind === 'type-select') return '';
    return answers[step.field.key] ?? '';
  }

  function setValue(v: string) {
    if (!step || step.field.kind === 'type-select') return;
    const key = step.field.key;
    setAnswers((prev) => ({ ...prev, [key]: v }));
  }

  function canProceed(): boolean {
    if (!step) return true;
    if (step.field.kind === 'type-select') return type !== null;
    const required = 'required' in step.field ? !!step.field.required : false;
    if (!required) return true;
    return currentValue().trim().length > 0;
  }

  async function handleConfirm() {
    // 確認画面 (isSummary) に到達する時点では、必ず種類選択ステップを通過済み
    // (canProceed が type!==null を要求する) なので type は non-null のはずだが、念のためガードする。
    if (!type) {
      setSubmitError(t('reservation.typeNotSelected'));
      return;
    }
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
      setSubmitError(err instanceof ReservationApiError ? err.message : t('reservation.saveError'));
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

  function openTableEditor(r: ReservationRecord) {
    setEditingTablesId(r.id);
    setEditingTableCodes(r.tableCodes);
    setTableSaveError(null);
  }

  function toggleTableCode(code: string) {
    setEditingTableCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function saveTableAssignment(id: string) {
    setTableSaving(true);
    setTableSaveError(null);
    try {
      await assignReservationTables(id, editingTableCodes);
      setEditingTablesId(null);
      loadList();
    } catch (err) {
      setTableSaveError(err instanceof ReservationApiError ? err.message : t('reservation.tableAssignError'));
    } finally {
      setTableSaving(false);
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
            ← {mode === 'list' ? t('reservation.navBack') : t('reservation.navToList')}
          </button>
          <div>
            <div className="text-base font-bold">{t('reservation.title')}</div>
            <div className="text-xs text-muted-foreground">
              {t('reservation.subtitle')}
            </div>
          </div>
        </div>
        {mode === 'list' && (
          <button
            onClick={startNew}
            className="h-10 rounded-lg bg-primary px-4.5 text-[13.5px] font-bold text-primary-foreground"
          >
            {t('reservation.newButton')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {mode === 'list' && (
          <div className="flex flex-col gap-3">
            {listLoading && <div className="text-sm text-muted-foreground">{t('common.loadingEllipsis')}</div>}
            {listError && <div className="text-sm text-destructive">{listError}</div>}
            {!listLoading && !listError && reservations.length === 0 && (
              <div className="rounded-xl border border-border p-5 text-center text-sm text-muted-foreground">
                {t('reservation.emptyList')}
              </div>
            )}
            {reservations.map((r) => (
              <div
                key={r.id}
                className={
                  'flex flex-col gap-3 rounded-xl border p-4 ' +
                  (r.status === 'cancelled' ? 'border-border bg-secondary/40 opacity-60' : 'border-border bg-card')
                }
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold">
                        {typeLabel(r.reservationType, t)}
                      </span>
                      {r.source === 'app' && (
                        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand">
                          {t('reservation.appReservationBadge')}
                        </span>
                      )}
                      {r.status === 'cancelled' && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold text-destructive">
                          {t('reservation.cancelledBadge')}
                        </span>
                      )}
                      {r.tableCodes.length > 0 && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-800">
                          {t('reservation.tableBadge', { tables: r.tableCodes.join(', ') })}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[14px] font-bold">
                      {t('reservation.summaryLine', {
                        date: r.reservationDate,
                        time: r.reservationTime ?? '',
                        name: r.customerName,
                        partyPart: r.partySize ? t('reservation.partyPart', { count: r.partySize }) : '',
                      })}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {r.phone ? t('reservation.phonePrefix', { phone: r.phone }) : ''}
                      {t('reservation.receivedByLabel', { name: r.createdByName ?? '-' })}
                      {r.notes ? t('reservation.notesSuffix', { notes: r.notes }) : ''}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    {r.status === 'confirmed' && (
                      <button
                        onClick={() => (editingTablesId === r.id ? setEditingTablesId(null) : openTableEditor(r))}
                        className="h-9 rounded-lg border border-border bg-card px-3.5 text-[12px] font-semibold text-foreground"
                      >
                        {r.tableCodes.length > 0 ? t('reservation.changeTablesButton') : t('reservation.setTablesButton')}
                      </button>
                    )}
                    {r.status === 'confirmed' && r.source === 'pos' && (
                      <button
                        onClick={() => handleCancel(r.id)}
                        className="h-9 rounded-lg border border-destructive px-3.5 text-[12px] font-semibold text-destructive"
                      >
                        {t('reservation.cancelButton')}
                      </button>
                    )}
                  </div>
                </div>

                {editingTablesId === r.id && (
                  <div className="rounded-lg border border-border bg-secondary/20 p-3">
                    <div className="mb-2 text-[11.5px] font-semibold text-muted-foreground">
                      {r.reservationTime ? t('reservation.selectTablesFrom', { time: r.reservationTime }) : t('reservation.selectTablesNoTime')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tableOptions.map((opt) => (
                        <button
                          key={opt.code}
                          onClick={() => toggleTableCode(opt.code)}
                          className={
                            'h-9 rounded-lg border px-3 text-[12.5px] font-semibold ' +
                            (editingTableCodes.includes(opt.code)
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-card text-foreground')
                          }
                        >
                          {opt.code}
                        </button>
                      ))}
                    </div>
                    {tableSaveError && <div className="mt-2 text-[12px] text-destructive">{tableSaveError}</div>}
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        onClick={() => setEditingTablesId(null)}
                        className="h-9 rounded-lg border border-border px-3.5 text-[12px] font-semibold"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        onClick={() => saveTableAssignment(r.id)}
                        disabled={tableSaving}
                        className="h-9 rounded-lg bg-primary px-4 text-[12px] font-bold text-primary-foreground disabled:opacity-60"
                      >
                        {tableSaving ? t('reservation.savingTables') : t('common.save')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'wizard' && step && step.field.kind === 'type-select' && (
          <div className="mx-auto flex max-w-[640px] flex-col gap-3">
            <div className="text-[11.5px] font-semibold text-muted-foreground">{t('reservation.basicInfoDoneNote')}</div>
            <div className="text-[15px] font-bold">{t('reservation.chooseTypeQuestion')}</div>
            {RESERVATION_TYPES.map((rt) => (
              <button
                key={rt}
                onClick={() => chooseType(rt)}
                className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary"
              >
                <div className="text-[14px] font-bold">{typeLabel(rt, t)}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">{typeDesc(rt, t)}</div>
              </button>
            ))}
            <div className="mt-1 flex justify-start">
              <button
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="h-11 rounded-lg border border-border px-5 text-[13px] font-semibold"
              >
                {t('reservation.navBack')}
              </button>
            </div>
          </div>
        )}

        {mode === 'wizard' && step && step.field.kind !== 'type-select' && (
          <div className="mx-auto flex max-w-[560px] flex-col gap-4">
            <div className="text-[11.5px] font-semibold text-muted-foreground">
              {type ? typeLabel(type, t) : t('reservation.basicInfoHearing')} ・ {stepIndex + 1} / {steps.length + 1}
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-[11px] font-semibold text-primary">{t('reservation.scriptLabel')}</div>
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
                {t('reservation.navBack')}
              </button>
              <button
                onClick={() => setStepIndex((i) => i + 1)}
                disabled={!canProceed()}
                className="h-11 rounded-lg bg-primary px-6 text-[13px] font-bold text-primary-foreground disabled:opacity-40"
              >
                {t('reservation.nextButton')}
              </button>
            </div>
          </div>
        )}

        {mode === 'wizard' && isSummary && (
          <div className="mx-auto flex max-w-[560px] flex-col gap-4">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="text-[11px] font-semibold text-primary">{t('reservation.scriptLabel')}</div>
              <div className="mt-1 text-[14px] leading-relaxed">
                「{t('reservation.summaryScript', {
                  name: answers.customerName ?? '',
                  partyPart: answers.partySize ? t('reservation.summaryScriptParty', { count: answers.partySize }) : '',
                  date: answers.reservationDate ?? '',
                  timePart: answers.reservationTime ? ` ${answers.reservationTime}` : '',
                })}」
              </div>
            </div>
            <div className="rounded-xl border border-border p-4 text-[12.5px] leading-relaxed">
              <div className="font-bold">{type ? typeLabel(type, t) : '-'}</div>
              <div className="mt-2 grid grid-cols-2 gap-y-1.5">
                <div className="text-muted-foreground">{t('reservation.nameLabel')}</div>
                <div>{answers.customerName || '-'}</div>
                <div className="text-muted-foreground">{t('reservation.phoneLabel')}</div>
                <div>{answers.phone || '-'}</div>
                <div className="text-muted-foreground">{t('reservation.partySizeLabel')}</div>
                <div>{answers.partySize ? t('reservation.partySizeValue', { count: answers.partySize }) : '-'}</div>
                <div className="text-muted-foreground">{t('reservation.dateTimeLabel')}</div>
                <div>
                  {answers.reservationDate || '-'} {answers.reservationTime || ''}
                </div>
                {DETAIL_KEYS.filter((k) => answers[k]).map((k) => {
                  const stepField = steps.find((s) => s.field.kind !== 'type-select' && s.field.key === k)?.field;
                  const displayValue =
                    stepField?.kind === 'select'
                      ? (stepField.options.find((o) => o.value === answers[k])?.label ?? answers[k])
                      : answers[k];
                  return (
                    <Fragment key={k}>
                      <div className="text-muted-foreground">{detailLabel(k, t)}</div>
                      <div>{displayValue}</div>
                    </Fragment>
                  );
                })}
                <div className="text-muted-foreground">{t('reservation.notesLabel')}</div>
                <div>{answers.notes || '-'}</div>
              </div>
            </div>
            {submitError && <div className="text-[12.5px] text-destructive">{submitError}</div>}
            <div className="mt-1 flex justify-between">
              <button
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="h-11 rounded-lg border border-border px-5 text-[13px] font-semibold"
              >
                {t('reservation.navBack')}
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="h-11 rounded-lg bg-primary px-6 text-[13px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {submitting ? t('reservation.savingConfirm') : t('reservation.confirmButton')}
              </button>
            </div>
          </div>
        )}

        {mode === 'done' && (
          <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 pt-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
              ✓
            </div>
            <div className="text-[15px] font-bold">{t('reservation.doneTitle')}</div>
            <div className="text-[12.5px] text-muted-foreground">
              「{t('reservation.doneScript', { name: answers.customerName ?? '' })}」
            </div>
            <div className="mt-2 flex gap-3">
              <button
                onClick={startNew}
                className="h-11 rounded-lg border border-border px-5 text-[13px] font-semibold"
              >
                {t('reservation.continueButton')}
              </button>
              <button
                onClick={() => setMode('list')}
                className="h-11 rounded-lg bg-primary px-5 text-[13px] font-bold text-primary-foreground"
              >
                {t('reservation.navToList')}
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
