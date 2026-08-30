'use client';

import { useEffect, useState } from 'react';
import type { TableStatus } from '@/lib/pos-types';
import { DEMO_TABLE_GROUPS } from '@/lib/demo-data';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import { TABLE_LAYOUT_CANVAS_HEIGHT, TABLE_LAYOUT_CANVAS_WIDTH } from '@/lib/table-layout-geometry';
import type { TableSessionRecord } from '@/lib/table-session-client';
import { drinkTimerState, elapsedMinutes, formatDuration } from '@/lib/table-timer';

const STATUS_LABEL: Record<TableStatus, string> = {
  available: 'Available',
  occupied: '使用中',
  billing: '会計待ち',
};

const STATUS_CLASS: Record<TableStatus, string> = {
  available: 'bg-card border-border text-foreground',
  occupied: 'bg-brand border-brand text-brand-foreground',
  billing: 'bg-amber-100 border-amber-300 text-amber-800',
};

const OBSTACLE_LABEL: Record<string, string> = { pillar: '柱', counter: 'カウンター', wall: '壁' };

// 卓の「滞在○分」「🍺残り○分」バッジ。1分ごとに再描画して経過時間を最新に保つ。
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
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none">
        滞在{stay}
      </span>
      {drink && (
        <span
          className={
            'rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ' +
            (drink.isExpired ? 'animate-pulse bg-destructive text-destructive-foreground' : 'bg-black/10')
          }
        >
          🍺{drink.isExpired ? '延長要' : formatDuration(drink.remainingMinutes)}
        </span>
      )}
    </div>
  );
}

export function TableMapScreen({
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
  const filters: { key: 'all' | TableStatus; label: string }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'available', label: 'Available' },
    { key: 'occupied', label: '使用中' },
    { key: 'billing', label: '会計待ち' },
  ];

  const tables = layoutItems.filter((t) => t.kind === 'table');
  const obstacles = layoutItems.filter((t) => t.kind !== 'table');
  // 設定画面の「テーブルレイアウト」で卓を1つも配置していない店舗は、これまで通りの
  // サンプル配置 (フロア/テラス/個室/カウンター) を表示する (既存店舗の挙動を壊さない)。
  const hasCustomLayout = tables.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex gap-2 px-5 pt-4">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onStatusFilter(f.key)}
            className={
              'h-[34px] rounded-lg border px-3.5 text-[12.5px] font-semibold ' +
              (statusFilter === f.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {hasCustomLayout ? (
        <div className="flex-1 overflow-auto px-5 py-4">
          <div
            className="relative mx-auto overflow-hidden rounded-2xl border-[1.5px] border-dashed border-border"
            style={{
              width: TABLE_LAYOUT_CANVAS_WIDTH,
              height: TABLE_LAYOUT_CANVAS_HEIGHT,
              backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          >
            {obstacles.map((o) => (
              <div
                key={o.id}
                className="absolute flex select-none flex-col items-center justify-center gap-0.5 rounded-lg border-[1.5px] border-dashed border-muted-foreground/50 bg-secondary/70 text-muted-foreground"
                style={{ left: o.x, top: o.y, width: o.width, height: o.height }}
              >
                <div className="px-1 text-center text-[12px] font-bold leading-tight">{o.table_code}</div>
                <div className="text-[9.5px] opacity-75">{OBSTACLE_LABEL[o.kind] ?? o.kind}</div>
              </div>
            ))}
            {tables
              .filter((t) => {
                const status = tableStatus[t.table_code] ?? 'available';
                return statusFilter === 'all' || statusFilter === status;
              })
              .map((t) => {
                const status = tableStatus[t.table_code] ?? 'available';
                return (
                  <button
                    key={t.id}
                    onClick={() => onSelectTable(t.table_code)}
                    className={
                      'absolute flex flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center ' +
                      STATUS_CLASS[status]
                    }
                    style={{ left: t.x, top: t.y, width: t.width, height: t.height }}
                  >
                    <div className="px-1 text-[12.5px] font-bold leading-tight">{t.table_code}</div>
                    <div className="text-[10px] opacity-90">
                      {t.seats > 0 ? `0/${t.seats} ・ ` : ''}
                      {STATUS_LABEL[status]}
                    </div>
                    <TableTimerBadges session={sessionByTable.get(t.table_code)} />
                  </button>
                );
              })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-5 py-4">
          {DEMO_TABLE_GROUPS.map((group) => {
            const groupTables = group.codes
              .map((code) => ({ code, status: tableStatus[code] ?? ('available' as TableStatus) }))
              .filter((t) => statusFilter === 'all' || statusFilter === t.status);
            if (groupTables.length === 0) return null;
            return (
              <div key={group.label} className="mb-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                <div className="grid grid-cols-6 gap-3">
                  {groupTables.map((t) => (
                    <button
                      key={t.code}
                      onClick={() => onSelectTable(t.code)}
                      className={
                        'flex min-h-20 flex-col gap-1.5 rounded-xl border p-3 text-left ' + STATUS_CLASS[t.status]
                      }
                    >
                      <div className="text-sm font-bold">{t.code}</div>
                      <div className="text-[11px] opacity-90">
                        0/{group.seats} ・ {STATUS_LABEL[t.status]}
                      </div>
                      <TableTimerBadges session={sessionByTable.get(t.code)} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
