'use client';

import { useEffect, useState } from 'react';
import type { TableStatus } from '@/lib/pos-types';
import { DEMO_TABLE_GROUPS } from '@/lib/demo-data';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import type { TableSessionRecord } from '@/lib/table-session-client';
import { drinkTimerState, elapsedMinutes, formatDuration } from '@/lib/table-timer';

// ハンディ端末向けの卓選択画面 (2026-08-31 追加。「ハンディ注文機能」)。
// レジ画面のテーブルマップ (table-map-screen.tsx) は 940×640px 固定キャンバスに絶対座標で
// 卓を配置する見取り図表示で、スマホ・タブレットの狭い画面には向かない。ハンディでは
// 同じ卓データ (layoutItems / tableSessions) を使い回しつつ、見取り図ではなく卓番号の
// レスポンシブなグリッド一覧として表示する (机の物理配置は見えないが、タップ操作は速い)。

const STATUS_LABEL: Record<TableStatus, string> = {
  available: '空席',
  occupied: '使用中',
  billing: '会計待ち',
};

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
        滞在{stay}
      </span>
      {drink && (
        <span
          className={
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ' +
            (drink.isExpired ? 'animate-pulse bg-destructive text-destructive-foreground' : 'bg-black/10')
          }
        >
          🍺{drink.isExpired ? '終了' : formatDuration(drink.remainingMinutes)}
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
}: {
  tableStatus: Record<string, TableStatus>;
  statusFilter: 'all' | TableStatus;
  onStatusFilter: (v: 'all' | TableStatus) => void;
  onSelectTable: (code: string) => void;
  layoutItems: TableLayoutItemRecord[];
  tableSessions: TableSessionRecord[];
}) {
  const sessionByTable = new Map(tableSessions.map((s) => [s.table_code, s]));

  // 実データがあればそれを sort_order 順で、無ければ (レイアウト未作成の店舗向け)
  // 従来のデモ卓グループ一覧にフォールバックする (table-map-screen.tsx と同じ方針)。
  const realTables = layoutItems
    .filter((t) => t.kind === 'table')
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => ({ code: t.table_code, seats: t.seats }));

  const groups: { label: string | null; tables: { code: string; seats: number }[] }[] =
    realTables.length > 0
      ? [{ label: null, tables: realTables }]
      : DEMO_TABLE_GROUPS.map((g) => ({
          label: g.label,
          tables: g.codes.map((code) => ({ code, seats: g.seats })),
        }));

  const filters: { key: 'all' | TableStatus; label: string }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'available', label: '空席' },
    { key: 'occupied', label: '使用中' },
    { key: 'billing', label: '会計待ち' },
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
                      <div className="mt-0.5 text-[10.5px] opacity-80">{t.seats}席・{STATUS_LABEL[status]}</div>
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
