'use client';

import { useEffect, useState } from 'react';
import type { TableStatus } from '@/lib/pos-types';
import { DEMO_TABLE_GROUPS } from '@/lib/demo-data';
import type { TableLayoutItemRecord } from '@/lib/table-layout-client';
import { TABLE_LAYOUT_CANVAS_HEIGHT, TABLE_LAYOUT_CANVAS_WIDTH } from '@/lib/table-layout-geometry';
import type { TableSessionRecord } from '@/lib/table-session-client';
import { drinkTimerState, elapsedMinutes, formatDuration } from '@/lib/table-timer';
import { useLanguage } from './language-context';

const STATUS_CLASS: Record<TableStatus, string> = {
  available: 'bg-card border-border text-foreground',
  occupied: 'bg-brand border-brand text-brand-foreground',
  billing: 'bg-amber-100 border-amber-300 text-amber-800',
};

// 多言語化 (2026-09-02追加): ステータス/障害物ラベルは t() 経由で解決するため、呼び出し側で
// useLanguage() の t を渡す関数に変更した (以前は静的 Record だった)。
function statusLabel(status: TableStatus, t: (key: string) => string): string {
  if (status === 'available') return t('tableMap.statusAvailable');
  if (status === 'occupied') return t('tableMap.statusOccupied');
  return t('tableMap.statusBilling');
}

function obstacleLabel(kind: string, t: (key: string) => string): string {
  if (kind === 'pillar') return t('tableMap.obstaclePillar');
  if (kind === 'counter') return t('tableMap.obstacleCounter');
  if (kind === 'wall') return t('tableMap.obstacleWall');
  return kind;
}

// 卓別の直近予約 (2026-09-02 追加。Tom「設定した席に予約マークがついて何時から予約かが
// 分かるようにしてほしい」への対応)。予約側 (reservation-screen.tsx) で卓を割り当てると、
// テーブルマップ上のその卓に「📅 19:00」のような小さなバッジが付く。
export type TableReservationBadge = { time: string | null; customerName: string };

function ReservationMark({ reservation }: { reservation: TableReservationBadge | undefined }) {
  const { t } = useLanguage();
  if (!reservation) return null;
  return (
    <span
      className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-violet-800"
      title={t('tableMap.reservationTitle', { name: reservation.customerName })}
    >
      📅{reservation.time ?? t('tableMap.reservationTimeUnknown')}
    </span>
  );
}

// 飲み放題タイマーが切れているか (テーブルマップ全体で「小さなバッジだけだと気づきにくい」
// という指摘を受け、卓の枠自体を赤くパルスさせて一目でわかるようにする 2026-08-31 追加)。
function isDrinkTimerExpired(session: TableSessionRecord | undefined): boolean {
  if (!session) return false;
  return !!drinkTimerState(session.drink_timer_started_at, session.drink_timer_minutes)?.isExpired;
}

// 卓の「滞在○分」「🍺残り○分」バッジ。1分ごとに再描画して経過時間を最新に保つ。
function TableTimerBadges({ session }: { session: TableSessionRecord | undefined }) {
  const { t } = useLanguage();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  const stay = formatDuration(elapsedMinutes(session.started_at));
  const drink = drinkTimerState(session.drink_timer_started_at, session.drink_timer_minutes);

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none">
        {t('timer.stay', { duration: stay })}
      </span>
      {drink && (
        <span
          className={
            'rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ' +
            (drink.isExpired ? 'animate-pulse bg-destructive text-destructive-foreground' : 'bg-black/10')
          }
        >
          🍺{drink.isExpired ? t('timer.drinkExpiredShort') : formatDuration(drink.remainingMinutes)}
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
  reservationsByTable = {},
  tableActionMode = 'none',
  moveSourceTable = null,
  mergeTargetTable = null,
  mergeSourceTables = [],
  tableActionBusy = false,
  tableActionError = null,
  onStartMove,
  onStartMerge,
  onCancelTableAction,
  onTableTapForAction,
  onConfirmMerge,
}: {
  tableStatus: Record<string, TableStatus>;
  statusFilter: 'all' | TableStatus;
  onStatusFilter: (v: 'all' | TableStatus) => void;
  onSelectTable: (code: string) => void;
  layoutItems: TableLayoutItemRecord[];
  tableSessions: TableSessionRecord[];
  /** 卓別の直近予約 (2026-09-02 追加)。省略時はバッジを表示しない。 */
  reservationsByTable?: Record<string, TableReservationBadge>;
  /** 席移動・会計合算 (2026-08-31 追加)。省略時は従来通りの通常モードのみ。 */
  tableActionMode?: 'none' | 'move' | 'merge';
  moveSourceTable?: string | null;
  mergeTargetTable?: string | null;
  mergeSourceTables?: string[];
  tableActionBusy?: boolean;
  tableActionError?: string | null;
  onStartMove?: () => void;
  onStartMerge?: () => void;
  onCancelTableAction?: () => void;
  onTableTapForAction?: (code: string) => void;
  onConfirmMerge?: () => void;
}) {
  const { t } = useLanguage();
  // 飲み放題の残り時間は Date.now() 基準で計算するため、セッション自体に変化が無くても
  // 定期的に再描画して「切れた瞬間」を卓の枠ハイライトに反映する。
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const sessionByTable = new Map(tableSessions.map((s) => [s.table_code, s]));
  const filters: { key: 'all' | TableStatus; label: string }[] = [
    { key: 'all', label: t('tableMap.filterAll') },
    { key: 'available', label: t('tableMap.statusAvailable') },
    { key: 'occupied', label: t('tableMap.statusOccupied') },
    { key: 'billing', label: t('tableMap.statusBilling') },
  ];

  const tables = layoutItems.filter((tbl) => tbl.kind === 'table');
  const obstacles = layoutItems.filter((tbl) => tbl.kind !== 'table');
  // 設定画面の「テーブルレイアウト」で卓を1つも配置していない店舗は、これまで通りの
  // サンプル配置 (フロア/テラス/個室/カウンター) を表示する (既存店舗の挙動を壊さない)。
  const hasCustomLayout = tables.length > 0;

  // 席移動・会計合算 (2026-08-31 追加)。モード中はテーブルをタップすると通常の注文画面遷移
  // ではなく、移動元/移動先・合算先/合算元の選択として扱う。
  const inActionMode = tableActionMode !== 'none';
  function handleTableTap(code: string) {
    if (inActionMode) onTableTapForAction?.(code);
    else onSelectTable(code);
  }
  function selectionRing(code: string): string {
    if (tableActionMode === 'move' && code === moveSourceTable) return ' ring-2 ring-primary ring-offset-1';
    if (tableActionMode === 'merge' && code === mergeTargetTable) return ' ring-2 ring-primary ring-offset-1';
    if (tableActionMode === 'merge' && mergeSourceTables.includes(code)) return ' ring-2 ring-amber-500 ring-offset-1';
    return '';
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => onStatusFilter(f.key)}
              disabled={inActionMode}
              className={
                'h-[34px] rounded-lg border px-3.5 text-[12.5px] font-semibold disabled:opacity-50 ' +
                (statusFilter === f.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        {!inActionMode && (
          <div className="flex gap-2">
            <button
              onClick={onStartMove}
              className="h-[34px] rounded-lg border border-dashed border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground"
            >
              {t('tableMap.moveSeat')}
            </button>
            <button
              onClick={onStartMerge}
              className="h-[34px] rounded-lg border border-dashed border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground"
            >
              {t('tableMap.mergeBilling')}
            </button>
          </div>
        )}
      </div>

      {inActionMode && (
        <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
          <div className="text-[12.5px] font-semibold text-foreground">
            {tableActionMode === 'move' &&
              (!moveSourceTable
                ? t('tableMap.moveInstructionSelectSource')
                : t('tableMap.moveInstructionSelectTarget', { table: moveSourceTable }))}
            {tableActionMode === 'merge' &&
              (!mergeTargetTable
                ? t('tableMap.mergeInstructionSelectTarget')
                : t('tableMap.mergeInstructionSelectSources', {
                    table: mergeTargetTable,
                    count: mergeSourceTables.length,
                  }))}
            {tableActionError && <div className="mt-1 text-destructive">{tableActionError}</div>}
          </div>
          <div className="flex flex-shrink-0 gap-2">
            {tableActionMode === 'merge' && mergeTargetTable && mergeSourceTables.length > 0 && (
              <button
                onClick={onConfirmMerge}
                disabled={tableActionBusy}
                className="h-9 rounded-lg bg-primary px-4 text-[12.5px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {tableActionBusy ? t('common.processing') : t('tableMap.mergeExecute')}
              </button>
            )}
            <button
              onClick={onCancelTableAction}
              disabled={tableActionBusy}
              className="h-9 rounded-lg border border-border bg-card px-4 text-[12.5px] font-semibold text-muted-foreground disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

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
                <div className="text-[9.5px] opacity-75">{obstacleLabel(o.kind, t)}</div>
              </div>
            ))}
            {tables
              .filter((tbl) => {
                const status = tableStatus[tbl.table_code] ?? 'available';
                return statusFilter === 'all' || statusFilter === status;
              })
              .map((tbl) => {
                const status = tableStatus[tbl.table_code] ?? 'available';
                const drinkExpired = isDrinkTimerExpired(sessionByTable.get(tbl.table_code));
                return (
                  <button
                    key={tbl.id}
                    onClick={() => handleTableTap(tbl.table_code)}
                    className={
                      'absolute flex flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center ' +
                      STATUS_CLASS[status] +
                      (drinkExpired ? ' animate-pulse ring-2 ring-destructive ring-offset-1' : '') +
                      selectionRing(tbl.table_code)
                    }
                    style={{ left: tbl.x, top: tbl.y, width: tbl.width, height: tbl.height }}
                  >
                    <div className="px-1 text-[12.5px] font-bold leading-tight">{tbl.table_code}</div>
                    <div className="text-[10px] opacity-90">
                      {tbl.seats > 0 ? `0/${tbl.seats} ・ ` : ''}
                      {statusLabel(status, t)}
                    </div>
                    <TableTimerBadges session={sessionByTable.get(tbl.table_code)} />
                    <ReservationMark reservation={reservationsByTable[tbl.table_code]} />
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
              .filter((tbl) => statusFilter === 'all' || statusFilter === tbl.status);
            if (groupTables.length === 0) return null;
            return (
              <div key={group.label} className="mb-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(group.labelKey)}
                </div>
                <div className="grid grid-cols-6 gap-3">
                  {groupTables.map((tbl) => (
                    <button
                      key={tbl.code}
                      onClick={() => handleTableTap(tbl.code)}
                      className={
                        'flex min-h-20 flex-col gap-1.5 rounded-xl border p-3 text-left ' +
                        STATUS_CLASS[tbl.status] +
                        (isDrinkTimerExpired(sessionByTable.get(tbl.code))
                          ? ' animate-pulse ring-2 ring-destructive ring-offset-1'
                          : '') +
                        selectionRing(tbl.code)
                      }
                    >
                      <div className="text-sm font-bold">{tbl.code}</div>
                      <div className="text-[11px] opacity-90">
                        0/{group.seats} ・ {statusLabel(tbl.status, t)}
                      </div>
                      <TableTimerBadges session={sessionByTable.get(tbl.code)} />
                      <ReservationMark reservation={reservationsByTable[tbl.code]} />
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
