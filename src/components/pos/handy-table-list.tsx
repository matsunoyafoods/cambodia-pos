'use client';

import { useEffect, useState } from 'react';
import type { HandyTableGroup, TableStatus } from '@/lib/pos-types';
import { DEMO_TABLE_GROUPS } from '@/lib/demo-data';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import type { TableSessionRecord } from '@/lib/table-session-client';
import { drinkTimerState, elapsedMinutes, formatDuration } from '@/lib/table-timer';
import { useLanguage } from './language-context';

// ハンディ端末向けの卓選択画面 (2026-08-31 追加。「ハンディ注文機能」)。
// レジ画面のテーブルマップ (table-map-screen.tsx) は 940×640px 固定キャンバスに絶対座標で
// 卓を配置する見取り図表示で、スマホ・タブレットの狭い画面には向かない。ハンディでは
// 同じ卓データ (layoutItems / tableSessions) を使い回しつつ、見取り図ではなく卓番号の
// レスポンシブなグリッド一覧として表示する (机の物理配置は見えないが、タップ操作は速い)。
//
// 並び順・グループ分け (2026-08-31 追加。「席番号がバラバラになっているので席を間違う
// 可能性がある」「ハンディで席をグループ分けできるといいね」への対応):
// 見取り図の座標から読み順を復元する方式は、実際の店舗レイアウトでは卓の種類 (T/C/BC/V) が
// 物理的に入り組んで配置されており、かえって分かりにくい結果になった。代わりに、設定画面
// 「ハンディ表示」タブで owner/manager が作成する `groups` (卓番号ベースのグループ・並び順、
// レジ画面の見取り図には一切影響しない) をここで使う。グループを1つも作っていない店舗では、
// 卓番号順 (英字プレフィックス→数字の自然順、例: C1,C2,...,T1,T2,...) にフォールバックする。
// どのグループにも入れていない卓は「未分類」として末尾にまとめて表示され、設定を何もしなくても
// 卓が画面から消えることはない。

function naturalTableCompare(a: string, b: string): number {
  const parse = (s: string) => {
    const m = s.match(/^(.*?)(\d+)$/);
    return m ? { prefix: m[1], num: parseInt(m[2], 10) } : { prefix: s, num: -1 };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : pa.prefix > pb.prefix ? 1 : 0;
  return pa.num - pb.num;
}

function statusLabel(status: TableStatus, t: (key: string) => string): string {
  if (status === 'available') return t('tableMap.statusAvailable');
  if (status === 'occupied') return t('tableMap.statusOccupied');
  return t('tableMap.statusBilling');
}

const STATUS_CLASS: Record<TableStatus, string> = {
  available: 'border-border bg-card text-foreground',
  occupied: 'border-brand bg-brand text-brand-foreground',
  billing: 'border-amber-300 bg-amber-100 text-amber-800',
};

function isDrinkTimerExpired(session: TableSessionRecord | undefined): boolean {
  if (!session) return false;
  return !!drinkTimerState(session.drink_timer_started_at, session.drink_timer_minutes)?.isExpired;
}

function TableTimerBadges({ session }: { session: TableSessionRecord | undefined }) {
  const { t } = useLanguage();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => tick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;
  const stay = formatDuration(elapsedMinutes(session.started_at));
  const drink = drinkTimerState(session.drink_timer_started_at, session.drink_timer_minutes);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
        {t('timer.stay', { duration: stay })}
      </span>
      {drink && (
        <span
          className={
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ' +
            (drink.isExpired ? 'animate-pulse bg-destructive text-destructive-foreground' : 'bg-black/10')
          }
        >
          🍺{drink.isExpired ? t('timer.drinkExpiredShort') : formatDuration(drink.remainingMinutes)}
        </span>
      )}
    </div>
  );
}

export function HandyTableList({
  tableStatus,
  statusFilter,
  onStatusFilter,
  onSelectTable,
  layoutItems,
  tableSessions,
  handyGroups,
}: {
  tableStatus: Record<string, TableStatus>;
  statusFilter: 'all' | TableStatus;
  onStatusFilter: (v: 'all' | TableStatus) => void;
  onSelectTable: (code: string) => void;
  layoutItems: TableLayoutItemRecord[];
  tableSessions: TableSessionRecord[];
  /** 設定画面「ハンディ表示」タブで設定した卓グループ・並び順 (2026-08-31 追加) */
  handyGroups: HandyTableGroup[];
}) {
  const { t: tr, menuText } = useLanguage();
  const sessionByTable = new Map(tableSessions.map((s) => [s.table_code, s]));

  const realTables = layoutItems.filter((t) => t.kind === 'table').map((t) => ({ code: t.table_code, seats: t.seats }));

  let groups: { label: string | null; tables: { code: string; seats: number }[] }[];
  if (realTables.length > 0) {
    const seatsByCode = new Map(realTables.map((t) => [t.code, t.seats]));
    const usedCodes = new Set<string>();
    const configured = handyGroups
      .map((g) => ({
        // 卓グループ名の翻訳表示 (2026-09-03 追加。ハンディ画面はスタッフが直接見るため、
        // 設定画面「ハンディ表示」タブで入力済みの多言語名があればそれを使う)。
        label: menuText(g.name, g.translations),
        tables: g.tableCodes
          .filter((code) => seatsByCode.has(code) && !usedCodes.has(code))
          .map((code) => {
            usedCodes.add(code);
            return { code, seats: seatsByCode.get(code)! };
          }),
      }))
      .filter((g) => g.tables.length > 0);
    const ungrouped = realTables.filter((t) => !usedCodes.has(t.code)).sort((a, b) => naturalTableCompare(a.code, b.code));

    if (configured.length > 0) {
      groups = ungrouped.length > 0 ? [...configured, { label: tr('settings.handy.unassignedGroupLabel'), tables: ungrouped }] : configured;
    } else {
      groups = [{ label: null, tables: realTables.slice().sort((a, b) => naturalTableCompare(a.code, b.code)) }];
    }
  } else {
    // レイアウト未作成の店舗向けフォールバック (table-map-screen.tsx と同じデモ配置)。
    groups = DEMO_TABLE_GROUPS.map((g) => ({ label: tr(g.labelKey), tables: g.codes.map((code) => ({ code, seats: g.seats })) }));
  }

  const filters: { key: 'all' | TableStatus; label: string }[] = [
    { key: 'all', label: tr('tableMap.filterAll') },
    { key: 'available', label: tr('tableMap.statusAvailable') },
    { key: 'occupied', label: tr('tableMap.statusOccupied') },
    { key: 'billing', label: tr('tableMap.statusBilling') },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onStatusFilter(f.key)}
            className={
              'h-8 flex-shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-semibold ' +
              (statusFilter === f.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {groups.map((g, gi) => {
          const visible = g.tables.filter((t) => statusFilter === 'all' || (tableStatus[t.code] ?? 'available') === statusFilter);
          if (visible.length === 0) return null;
          return (
            <div key={g.label ?? `_g${gi}`} className={gi > 0 ? 'mt-5' : ''}>
              {g.label && <div className="mb-2 text-[12px] font-bold text-muted-foreground">{g.label}</div>}
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {visible.map((t) => {
                  const status = tableStatus[t.code] ?? 'available';
                  const session = sessionByTable.get(t.code);
                  const expired = isDrinkTimerExpired(session);
                  return (
                    <button
                      key={t.code}
                      onClick={() => onSelectTable(t.code)}
                      className={
                        'flex flex-col items-center justify-center rounded-xl border-2 px-2 py-3.5 text-center ' +
                        STATUS_CLASS[status] +
                        (expired ? ' animate-pulse ring-2 ring-destructive' : '')
                      }
                    >
                      <div className="text-[15px] font-bold">{t.code}</div>
                      <div className="mt-0.5 text-[10.5px] opacity-80">
                        {tr('settings.handy.seatsCount', { n: t.seats })}・{statusLabel(status, tr)}
                      </div>
                      <TableTimerBadges session={session} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
