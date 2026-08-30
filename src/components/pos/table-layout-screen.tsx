'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  createTableLayoutItem,
  deleteTableLayoutItem,
  listTableLayout,
  updateTableLayoutItem,
  PosTableLayoutApiError,
  type TableLayoutItemRecord,
  type TableLayoutKind,
} from '@/lib/table-layout-client';

const KIND_META: Record<TableLayoutKind, { label: string; addLabel: string; defaultCode: string }> = {
  table: { label: '卓', addLabel: '＋ 卓を追加', defaultCode: '新卓' },
  pillar: { label: '柱', addLabel: '＋ 柱を追加', defaultCode: '柱' },
  counter: { label: 'カウンター', addLabel: '＋ カウンターを追加', defaultCode: 'カウンター' },
  wall: { label: '壁', addLabel: '＋ 壁を追加', defaultCode: '壁' },
};
const ADD_KINDS: TableLayoutKind[] = ['table', 'pillar', 'counter'];

// pos.table_layouts (POS ネイティブ) にそのまま対応する画面。位置・サイズ・名前・席数の
// 変更はすべて都度 API に反映される (以前はローカル state のみでリロードで消えていた)。
export function TableLayoutScreen() {
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = isPosNative && (me.role === 'owner' || me.role === 'manager');

  const [items, setItems] = useState<TableLayoutItemRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const nextIndex = useRef(1);
  const canvasRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setError(null);
    listTableLayout()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof PosTableLayoutApiError ? err.message : '取得に失敗しました'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = items?.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    setNameDraft(selected?.table_code ?? '');
  }, [selected?.id, selected?.table_code]);

  async function addItem(kind: TableLayoutKind) {
    const n = nextIndex.current++;
    const meta = KIND_META[kind];
    try {
      const { item } = await createTableLayoutItem({
        tableCode: `${meta.defaultCode}${n}`,
        kind,
        x: 24 + ((n * 37) % 500),
        y: 24 + ((n * 53) % 400),
      });
      setItems((prev) => [...(prev ?? []), item]);
      setSelectedId(item.id);
    } catch (err) {
      setError(err instanceof PosTableLayoutApiError ? err.message : '追加に失敗しました');
    }
  }

  async function patchItem(id: string, patch: Parameters<typeof updateTableLayoutItem>[1]) {
    try {
      const { item } = await updateTableLayoutItem(id, patch);
      setItems((prev) => (prev ?? []).map((t) => (t.id === id ? item : t)));
    } catch (err) {
      setError(err instanceof PosTableLayoutApiError ? err.message : '更新に失敗しました');
      load();
    }
  }

  async function deleteSelected() {
    if (!selectedId) return;
    const id = selectedId;
    setSelectedId(null);
    try {
      await deleteTableLayoutItem(id);
      setItems((prev) => (prev ?? []).filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof PosTableLayoutApiError ? err.message : '削除に失敗しました');
      load();
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!draggingId || !canvasRef.current) return;
    const item = (items ?? []).find((t) => t.id === draggingId);
    if (!item) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(4, Math.min(rect.width - item.width - 4, e.clientX - rect.left - item.width / 2));
    const y = Math.max(4, Math.min(rect.height - item.height - 4, e.clientY - rect.top - item.height / 2));
    setItems((prev) => (prev ?? []).map((t) => (t.id === draggingId ? { ...t, x: Math.round(x), y: Math.round(y) } : t)));
    patchItem(draggingId, { x: Math.round(x), y: Math.round(y) });
    setDraggingId(null);
  }

  function commitName() {
    if (!selected) return;
    const value = nameDraft.trim();
    if (!value || value === selected.table_code) {
      setNameDraft(selected.table_code);
      return;
    }
    patchItem(selected.id, { tableCode: value });
  }

  function resizeSelected(dw: number, dh: number) {
    if (!selected) return;
    const width = Math.max(24, Math.min(600, selected.width + dw));
    const height = Math.max(24, Math.min(600, selected.height + dh));
    setItems((prev) => (prev ?? []).map((t) => (t.id === selected.id ? { ...t, width, height } : t)));
    patchItem(selected.id, { width, height });
  }

  function seatsDelta(delta: number) {
    if (!selected) return;
    const seats = Math.max(0, selected.seats + delta);
    setItems((prev) => (prev ?? []).map((t) => (t.id === selected.id ? { ...t, seats } : t)));
    patchItem(selected.id, { seats });
  }

  if (!isPosNative) {
    return (
      <div className="flex w-[640px] flex-col gap-3.5 rounded-2xl border border-border bg-background p-6">
        <div className="text-[15px] font-bold">テーブルレイアウト編集</div>
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-[13px] leading-relaxed text-amber-900">
            この機能はPINログインでのみご利用いただけます。現在 Telegram (matsunoya-dine) 連携ログインでアクセスしているため、一度PINでログインし直してください。
          </div>
          <button
            onClick={() => router.push('/login')}
            className="mt-1 h-[38px] w-fit rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground"
          >
            PINでログインし直す
          </button>
        </div>
      </div>
    );
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
            <div className="text-xs text-muted-foreground">
              {canManage ? '卓・柱・カウンターをドラッグして配置できます (自動保存)' : '閲覧のみ (編集には manager 以上の権限が必要です)'}
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            {ADD_KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => addItem(kind)}
                className="h-9 rounded-lg border border-dashed border-brand px-3 text-[12.5px] font-semibold text-brand"
              >
                {KIND_META[kind].addLabel}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="border-b border-border px-6 py-2 text-xs text-destructive">{error}</div>}

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={canvasRef}
          onDragOver={(e) => canManage && e.preventDefault()}
          onDrop={canManage ? onDrop : undefined}
          className="relative m-5 flex-1 overflow-hidden rounded-2xl border-[1.5px] border-dashed border-border"
          style={{
            backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          {items === null && !error && (
            <div className="p-5 text-[12.5px] text-muted-foreground">読み込み中…</div>
          )}
          {items?.map((t) => {
            const isSel = t.id === selectedId;
            const isTable = t.kind === 'table';
            return (
              <div
                key={t.id}
                draggable={canManage}
                onDragStart={() => setDraggingId(t.id)}
                onClick={() => setSelectedId(t.id)}
                className={
                  'absolute flex select-none flex-col items-center justify-center gap-0.5 rounded-lg ' +
                  (canManage ? 'cursor-grab' : 'cursor-pointer') +
                  ' ' +
                  (isSel
                    ? 'bg-brand text-brand-foreground shadow-[0_0_0_3px_hsl(var(--brand)/0.3)]'
                    : isTable
                      ? 'border-[1.5px] border-border bg-card text-foreground'
                      : 'border-[1.5px] border-dashed border-muted-foreground/50 bg-secondary/70 text-muted-foreground')
                }
                style={{ left: t.x, top: t.y, width: t.width, height: t.height }}
              >
                <div className="px-1 text-center text-[13px] font-bold leading-tight">{t.table_code}</div>
                {isTable && <div className="text-[10.5px] opacity-85">{t.seats}席</div>}
                {!isTable && <div className="text-[10px] opacity-75">{KIND_META[t.kind].label}</div>}
              </div>
            );
          })}
        </div>

        <div className="flex w-[280px] flex-col gap-3.5 overflow-auto border-l border-border p-4.5">
          {selected ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                選択中の{KIND_META[selected.kind].label}
              </div>
              <div>
                <div className="mb-1 text-[11.5px] text-muted-foreground">名前</div>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  disabled={!canManage}
                  className="h-[38px] w-full rounded-lg border border-border px-2.5 text-[13.5px] disabled:opacity-60"
                />
              </div>

              {selected.kind === 'table' && (
                <div>
                  <div className="mb-1 text-[11.5px] text-muted-foreground">席数</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => seatsDelta(-1)}
                      disabled={!canManage}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border disabled:opacity-50"
                    >
                      −
                    </button>
                    <div className="w-6 text-center font-semibold">{selected.seats}</div>
                    <button
                      onClick={() => seatsDelta(1)}
                      disabled={!canManage}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border disabled:opacity-50"
                    >
                      ＋
                    </button>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 text-[11.5px] text-muted-foreground">大きさ (幅 × 高さ)</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => resizeSelected(-8, 0)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    幅−
                  </button>
                  <button
                    onClick={() => resizeSelected(8, 0)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    幅＋
                  </button>
                  <div className="mx-1 w-14 text-center text-[12px] text-muted-foreground">
                    {selected.width}×{selected.height}
                  </div>
                  <button
                    onClick={() => resizeSelected(0, -8)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    高−
                  </button>
                  <button
                    onClick={() => resizeSelected(0, 8)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    高＋
                  </button>
                </div>
              </div>

              {canManage && (
                <button
                  onClick={deleteSelected}
                  className="h-[38px] rounded-lg border border-destructive text-[12.5px] font-semibold text-destructive"
                >
                  削除
                </button>
              )}
            </div>
          ) : (
            <div className="px-0.5 py-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              見取り図の卓・柱・カウンターをタップすると、名前や席数・大きさを編集できます。ドラッグで自由に配置を変更できます。変更は自動的に保存されます。
            </div>
          )}

          <div className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
            配置はこの店舗のPOS専用データとして保存されます。
          </div>
        </div>
      </div>
    </div>
  );
}
