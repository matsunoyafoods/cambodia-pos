'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type TableLayoutItem = { id: string; code: string; seats: number; x: number; y: number };

const INITIAL_TABLES: TableLayoutItem[] = [
  { id: 't1', code: 'BC1', seats: 4, x: 24, y: 24 },
  { id: 't2', code: 'BC2', seats: 4, x: 130, y: 24 },
  { id: 't3', code: 'V1', seats: 4, x: 24, y: 120 },
  { id: 't4', code: 'V2', seats: 4, x: 130, y: 120 },
  { id: 't5', code: 'C1', seats: 2, x: 24, y: 216 },
  { id: 't6', code: '5', seats: 4, x: 320, y: 24 },
];

// pos.table_layouts (integration-spec.md 3.4) にそのまま対応する画面。
// 保存ボタンは `PUT /api/pos/table-layouts/:id` を叩く想定 (現状はローカル state のみ)。
export function TableLayoutScreen() {
  const router = useRouter();
  const [tables, setTables] = useState<TableLayoutItem[]>(INITIAL_TABLES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nextIndex = useRef(7);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selected = tables.find((t) => t.id === selectedId) ?? null;

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!draggingId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(4, Math.min(rect.width - 92, e.clientX - rect.left - 42));
    const y = Math.max(4, Math.min(rect.height - 72, e.clientY - rect.top - 32));
    setTables((prev) => prev.map((t) => (t.id === draggingId ? { ...t, x, y } : t)));
    setDraggingId(null);
    setSaved(false);
  }

  function addTable() {
    const n = nextIndex.current++;
    setTables((prev) => [
      ...prev,
      { id: 't' + n, code: '新卓' + n, seats: 4, x: 24 + ((n * 37) % 500), y: 320 + ((n * 53) % 160) },
    ]);
    setSaved(false);
  }

  function renameSelected(v: string) {
    setTables((prev) => prev.map((t) => (t.id === selectedId ? { ...t, code: v } : t)));
    setSaved(false);
  }
  function seatsDelta(delta: number) {
    setTables((prev) => prev.map((t) => (t.id === selectedId ? { ...t, seats: Math.max(1, t.seats + delta) } : t)));
    setSaved(false);
  }
  function deleteSelected() {
    setTables((prev) => prev.filter((t) => t.id !== selectedId));
    setSelectedId(null);
    setSaved(false);
  }

  return (
    <div className="flex h-[800px] w-[1280px] flex-col overflow-hidden bg-background">
      <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/pos')}
            className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-secondary"
          >
            ← 戻る
          </button>
          <div>
            <div className="text-base font-bold">テーブルレイアウト編集</div>
            <div className="text-xs text-muted-foreground">卓をドラッグして見取り図に配置できます</div>
          </div>
        </div>
        <button
          onClick={() => setSaved(true)}
          className={
            'h-10 rounded-lg px-4.5 text-[13.5px] font-bold ' +
            (saved ? 'bg-emerald-100 text-emerald-600' : 'bg-primary text-primary-foreground')
          }
        >
          {saved ? '保存しました ✓' : '保存'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={canvasRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="relative m-5 flex-1 overflow-hidden rounded-2xl border-[1.5px] border-dashed border-border"
          style={{
            backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          {tables.map((t) => {
            const isSel = t.id === selectedId;
            return (
              <div
                key={t.id}
                draggable
                onDragStart={() => setDraggingId(t.id)}
                onClick={() => setSelectedId(t.id)}
                className={
                  'absolute flex h-16 w-[84px] cursor-grab select-none flex-col items-center justify-center gap-0.5 rounded-lg ' +
                  (isSel
                    ? 'bg-brand text-brand-foreground shadow-[0_0_0_3px_hsl(var(--brand)/0.3)]'
                    : 'border-[1.5px] border-border bg-card text-foreground')
                }
                style={{ left: t.x, top: t.y }}
              >
                <div className="text-[13.5px] font-bold">{t.code}</div>
                <div className="text-[10.5px] opacity-85">{t.seats}席</div>
              </div>
            );
          })}
        </div>

        <div className="flex w-[280px] flex-col gap-3.5 overflow-auto border-l border-border p-4.5">
          <button
            onClick={addTable}
            className="flex h-[42px] items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand text-[13px] font-semibold text-brand"
          >
            ＋ 卓を追加
          </button>

          {selected ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">選択中の卓</div>
              <div>
                <div className="mb-1 text-[11.5px] text-muted-foreground">卓番号</div>
                <input
                  value={selected.code}
                  onChange={(e) => renameSelected(e.target.value)}
                  className="h-[38px] w-full rounded-lg border border-border px-2.5 text-[13.5px]"
                />
              </div>
              <div>
                <div className="mb-1 text-[11.5px] text-muted-foreground">席数</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => seatsDelta(-1)}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border"
                  >
                    −
                  </button>
                  <div className="w-6 text-center font-semibold">{selected.seats}</div>
                  <button
                    onClick={() => seatsDelta(1)}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border"
                  >
                    ＋
                  </button>
                </div>
              </div>
              <button
                onClick={deleteSelected}
                className="h-[38px] rounded-lg border border-destructive text-[12.5px] font-semibold text-destructive"
              >
                この卓を削除
              </button>
            </div>
          ) : (
            <div className="px-0.5 py-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              見取り図の卓をタップすると、卓番号や席数を編集できます。ドラッグで自由に配置を変更できます。
            </div>
          )}

          <div className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
            配置は matsunoya-dine 管理画面・POS 双方から編集でき、変更は即時反映されます。
          </div>
        </div>
      </div>
    </div>
  );
}
