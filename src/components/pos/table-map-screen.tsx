'use client';

import type { TableStatus } from '@/lib/pos-types';
import { DEMO_TABLE_GROUPS } from '@/lib/demo-data';

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

export function TableMapScreen({
  tableStatus,
  statusFilter,
  onStatusFilter,
  onSelectTable,
}: {
  tableStatus: Record<string, TableStatus>;
  statusFilter: 'all' | TableStatus;
  onStatusFilter: (v: 'all' | TableStatus) => void;
  onSelectTable: (code: string) => void;
}) {
  const filters: { key: 'all' | TableStatus; label: string }[] = [
    { key: 'all', label: 'すべて' },
    { key: 'available', label: 'Available' },
    { key: 'occupied', label: '使用中' },
    { key: 'billing', label: '会計待ち' },
  ];

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

      <div className="flex-1 overflow-auto px-5 py-4">
        {DEMO_TABLE_GROUPS.map((group) => {
          const tables = group.codes
            .map((code) => ({ code, status: tableStatus[code] ?? ('available' as TableStatus) }))
            .filter((t) => statusFilter === 'all' || statusFilter === t.status);
          if (tables.length === 0) return null;
          return (
            <div key={group.label} className="mb-6">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="grid grid-cols-6 gap-3">
                {tables.map((t) => (
                  <button
                    key={t.code}
                    onClick={() => onSelectTable(t.code)}
                    className={
                      'flex h-20 flex-col gap-1.5 rounded-xl border p-3 text-left ' + STATUS_CLASS[t.status]
                    }
                  >
                    <div className="text-sm font-bold">{t.code}</div>
                    <div className="text-[11px] opacity-90">
                      0/{group.seats} ・ {STATUS_LABEL[t.status]}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
