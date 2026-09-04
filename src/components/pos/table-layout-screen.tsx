'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { TABLE_LAYOUT_CANVAS_HEIGHT, TABLE_LAYOUT_CANVAS_WIDTH } from '@/lib/table-layout-geometry';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// 多言語化 (2026-09-04 追加。以前は「別画面なのでスコープ外」としていたが、Tom からの
// 指摘を受けてこの画面も5言語対応した)。t() 経由で解決するため静的 Record から関数に変更。
function kindMeta(kind: TableLayoutKind, t: (key: string) => string): { label: string; addLabel: string; defaultCode: string } {
  switch (kind) {
    case 'table':
      return { label: t('tableLayout.kind.table'), addLabel: t('tableLayout.addTable'), defaultCode: t('tableLayout.newCodeTable') };
    case 'pillar':
      return { label: t('tableLayout.kind.pillar'), addLabel: t('tableLayout.addPillar'), defaultCode: t('tableLayout.kind.pillar') };
    case 'counter':
      return { label: t('tableLayout.kind.counter'), addLabel: t('tableLayout.addCounter'), defaultCode: t('tableLayout.kind.counter') };
    case 'wall':
      return { label: t('tableLayout.kind.wall'), addLabel: t('tableLayout.addWall'), defaultCode: t('tableLayout.kind.wall') };
  }
}
const ADD_KINDS: TableLayoutKind[] = ['table', 'pillar', 'counter'];

// クライアント側だけで作った未保存の新規項目には tmp- プレフィックスの仮IDを振る。
// 「保存」を押した時点で isNewItem() で見分けて POST するか PATCH するかを判定する。
function isNewItem(id: string) {
  return id.startsWith('tmp-');
}

type Clipboard = {
  table_code: string;
  kind: TableLayoutKind;
  seats: number;
  width: number;
  height: number;
};

// pos.table_layouts (POS ネイティブ) に対応する画面。
// 編集はまずローカル state だけに反映し (ドラッグ・サイズ変更・複製など)、
// ヘッダーの「保存」を押した時点でまとめて API に反映する。
export function TableLayoutScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <TableLayoutScreenInner />
    </LanguageProvider>
  );
}

function TableLayoutScreenInner() {
  // t() の別名を tr にしているのは、この画面のテーブル項目ループ変数に慣習的に `t` を
  // 使っているため (items.map((t) => ...) 等)。翻訳関数と衝突しないよう区別する。
  const { t: tr } = useLanguage();
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = isPosNative && (me.role === 'owner' || me.role === 'manager');

  const [items, setItems] = useState<TableLayoutItemRecord[] | null>(null);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [widthDraft, setWidthDraft] = useState('');
  const [heightDraft, setHeightDraft] = useState('');
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const nextIndex = useRef(1);
  const canvasRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setError(null);
    listTableLayout()
      .then((res) => {
        setItems(res.items);
        setDirtyIds(new Set());
        setDeletedIds(new Set());
        setSaved(false);
      })
      .catch((err) => setError(err instanceof PosTableLayoutApiError ? err.message : tr('tableLayout.fetchError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = items?.find((t) => t.id === selectedId) ?? null;
  const hasUnsavedChanges = dirtyIds.size > 0 || deletedIds.size > 0 || (items ?? []).some((t) => isNewItem(t.id));

  useEffect(() => {
    setNameDraft(selected?.table_code ?? '');
  }, [selected?.id, selected?.table_code]);

  // 幅・高さの直接入力欄は入力中 (「」や末尾だけ消した状態など) を自由に許すため、
  // 選択中の item の値を直接 value に束縛せず下書き文字列として持つ。確定 (blur) 時に
  // パース・クランプして反映する。selected.width/height 自体が変わったとき
  // (ステッパーやドラッグでのリサイズ・別アイテム選択) は下書きを追従させる。
  useEffect(() => {
    setWidthDraft(selected ? String(selected.width) : '');
    setHeightDraft(selected ? String(selected.height) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.width, selected?.height]);

  // 保存されていない変更があるまま離れようとしたら一言確認する。
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  function goBack() {
    if (hasUnsavedChanges && !window.confirm(tr('tableLayout.confirmLeaveUnsaved'))) {
      return;
    }
    router.push('/pos');
  }

  function markDirty(id: string) {
    if (isNewItem(id)) return; // 新規はどのみち保存時に POST するので dirty 管理は不要
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function updateLocal(id: string, patch: Partial<TableLayoutItemRecord>) {
    setItems((prev) => (prev ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)));
    markDirty(id);
    setSaved(false);
  }

  function nextAvailableName(base: string, existing: Set<string>): string {
    const m = base.match(/^(.*?)(\d+)$/);
    if (m) {
      let n = parseInt(m[2], 10) + 1;
      let candidate = `${m[1]}${n}`;
      while (existing.has(candidate)) {
        n += 1;
        candidate = `${m[1]}${n}`;
      }
      return candidate;
    }
    const copyLabel = tr('tableLayout.copyLabel');
    let candidate = `${base}${copyLabel}`;
    let i = 2;
    while (existing.has(candidate)) {
      candidate = `${base}${copyLabel}${i}`;
      i += 1;
    }
    return candidate;
  }

  function addItem(kind: TableLayoutKind) {
    const n = nextIndex.current++;
    const meta = kindMeta(kind, tr);
    const width = kind === 'table' ? 84 : kind === 'pillar' ? 32 : 160;
    const height = kind === 'table' ? 64 : kind === 'pillar' ? 32 : 40;
    const existing = new Set((items ?? []).map((t) => t.table_code));
    const newItem: TableLayoutItemRecord = {
      id: `tmp-${Date.now()}-${n}`,
      table_code: nextAvailableName(`${meta.defaultCode}${n}`, existing),
      kind,
      seats: kind === 'table' ? 4 : 0,
      x: Math.min(TABLE_LAYOUT_CANVAS_WIDTH - width - 4, 24 + ((n * 37) % 500)),
      y: Math.min(TABLE_LAYOUT_CANVAS_HEIGHT - height - 4, 24 + ((n * 53) % 400)),
      width,
      height,
      sort_order: (items ?? []).length,
    };
    setItems((prev) => [...(prev ?? []), newItem]);
    setSelectedId(newItem.id);
    setSaved(false);
  }

  function copySelected() {
    if (!selected) return;
    setClipboard({
      table_code: selected.table_code,
      kind: selected.kind,
      seats: selected.seats,
      width: selected.width,
      height: selected.height,
    });
  }

  function pasteClipboard() {
    if (!clipboard) return;
    const n = nextIndex.current++;
    const existing = new Set((items ?? []).map((t) => t.table_code));
    const base = selected && selected.kind === clipboard.kind ? selected : null;
    const x = Math.max(4, Math.min(TABLE_LAYOUT_CANVAS_WIDTH - clipboard.width - 4, (base?.x ?? 24) + 20));
    const y = Math.max(4, Math.min(TABLE_LAYOUT_CANVAS_HEIGHT - clipboard.height - 4, (base?.y ?? 24) + 20));
    const newItem: TableLayoutItemRecord = {
      id: `tmp-${Date.now()}-${n}`,
      table_code: nextAvailableName(clipboard.table_code, existing),
      kind: clipboard.kind,
      seats: clipboard.seats,
      x,
      y,
      width: clipboard.width,
      height: clipboard.height,
      sort_order: (items ?? []).length,
    };
    setItems((prev) => [...(prev ?? []), newItem]);
    setSelectedId(newItem.id);
    setSaved(false);
  }

  // Cmd/Ctrl+C ・ Cmd/Ctrl+V での複製もサポートする (入力欄にフォーカス中は無効)。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!canManage) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'c' || e.key === 'C') {
        copySelected();
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        pasteClipboard();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, selected, clipboard, items]);

  function deleteSelected() {
    if (!selectedId) return;
    const id = selectedId;
    setSelectedId(null);
    setItems((prev) => (prev ?? []).filter((t) => t.id !== id));
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (!isNewItem(id)) {
      setDeletedIds((prev) => new Set(prev).add(id));
    }
    setSaved(false);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!draggingId || !canvasRef.current) return;
    const item = (items ?? []).find((t) => t.id === draggingId);
    if (!item) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(4, Math.min(rect.width - item.width - 4, e.clientX - rect.left - item.width / 2));
    const y = Math.max(4, Math.min(rect.height - item.height - 4, e.clientY - rect.top - item.height / 2));
    updateLocal(draggingId, { x: Math.round(x), y: Math.round(y) });
    setDraggingId(null);
  }

  function commitName() {
    if (!selected) return;
    const value = nameDraft.trim();
    if (!value || value === selected.table_code) {
      setNameDraft(selected.table_code);
      return;
    }
    updateLocal(selected.id, { table_code: value });
  }

  function resizeSelected(dw: number, dh: number) {
    if (!selected) return;
    const width = Math.max(24, Math.min(600, selected.width + dw));
    const height = Math.max(24, Math.min(600, selected.height + dh));
    updateLocal(selected.id, { width, height });
  }

  function commitSize(field: 'width' | 'height') {
    if (!selected) return;
    const raw = field === 'width' ? widthDraft : heightDraft;
    const value = parseInt(raw, 10);
    const current = selected[field];
    const clamped = Number.isNaN(value) ? current : Math.max(24, Math.min(600, value));
    if (clamped !== current) {
      updateLocal(selected.id, { [field]: clamped } as Partial<TableLayoutItemRecord>);
    } else if (field === 'width') {
      setWidthDraft(String(current));
    } else {
      setHeightDraft(String(current));
    }
  }

  function seatsDelta(delta: number) {
    if (!selected) return;
    const seats = Math.max(0, selected.seats + delta);
    updateLocal(selected.id, { seats });
  }

  async function saveAll() {
    if (!items) return;
    setSaving(true);
    setError(null);
    let hadError = false;
    const stillDirty = new Set<string>();
    const stillDeleted = new Set<string>();

    for (const id of deletedIds) {
      try {
        await deleteTableLayoutItem(id);
      } catch (err) {
        stillDeleted.add(id);
        hadError = true;
        setError(err instanceof PosTableLayoutApiError ? err.message : tr('tableLayout.deleteError'));
      }
    }

    const nextItems: TableLayoutItemRecord[] = [];
    for (const item of items) {
      if (isNewItem(item.id)) {
        try {
          const { item: created } = await createTableLayoutItem({
            tableCode: item.table_code,
            kind: item.kind,
            seats: item.seats,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          });
          nextItems.push(created);
          if (selectedId === item.id) setSelectedId(created.id);
        } catch (err) {
          nextItems.push(item);
          hadError = true;
          setError(err instanceof PosTableLayoutApiError ? err.message : tr('tableLayout.saveError'));
        }
      } else if (dirtyIds.has(item.id)) {
        try {
          const { item: updated } = await updateTableLayoutItem(item.id, {
            tableCode: item.table_code,
            kind: item.kind,
            seats: item.seats,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          });
          nextItems.push(updated);
        } catch (err) {
          nextItems.push(item);
          stillDirty.add(item.id);
          hadError = true;
          setError(err instanceof PosTableLayoutApiError ? err.message : tr('tableLayout.saveError'));
        }
      } else {
        nextItems.push(item);
      }
    }

    setItems(nextItems);
    setDirtyIds(stillDirty);
    setDeletedIds(stillDeleted);
    setSaving(false);
    setSaved(!hadError);
  }

  const clipboardLabel = useMemo(() => {
    if (!clipboard) return null;
    return tr('tableLayout.clipboardLabel', { kind: kindMeta(clipboard.kind, tr).label, code: clipboard.table_code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboard]);

  if (!isPosNative) {
    return (
      <div className="flex w-[640px] flex-col gap-3.5 rounded-2xl border border-border bg-background p-6">
        <div className="text-[15px] font-bold">{tr('tableLayout.title')}</div>
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-[13px] leading-relaxed text-amber-900">
            {tr('tableLayout.pinRequiredBody')}
          </div>
          <button
            onClick={() => router.push('/login')}
            className="mt-1 h-[38px] w-fit rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground"
          >
            {tr('tableLayout.pinRequiredButton')}
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
            onClick={goBack}
            className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-secondary"
          >
            {tr('tableLayout.backButton')}
          </button>
          <div>
            <div className="text-base font-bold">{tr('tableLayout.title')}</div>
            <div className="text-xs text-muted-foreground">
              {canManage
                ? tr('tableLayout.subtitleEditable')
                : tr('tableLayout.subtitleReadOnly')}
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
                {kindMeta(kind, tr).addLabel}
              </button>
            ))}
            <button
              onClick={pasteClipboard}
              disabled={!clipboard}
              className="h-9 rounded-lg border border-border px-3 text-[12.5px] font-semibold disabled:opacity-40"
            >
              {tr('tableLayout.pasteButton')}
            </button>
            <button
              onClick={saveAll}
              disabled={saving || !hasUnsavedChanges}
              className={
                'h-9 rounded-lg px-4 text-[12.5px] font-bold disabled:opacity-60 ' +
                (saved ? 'bg-emerald-100 text-emerald-600' : 'bg-primary text-primary-foreground')
              }
            >
              {saving ? tr('tableLayout.saving') : saved ? tr('tableLayout.saved') : hasUnsavedChanges ? tr('tableLayout.saveWithDot') : tr('tableLayout.saveButton')}
            </button>
          </div>
        )}
      </div>

      {error && <div className="border-b border-border px-6 py-2 text-xs text-destructive">{error}</div>}
      {clipboardLabel && (
        <div className="border-b border-border bg-secondary/50 px-6 py-1.5 text-[11px] text-muted-foreground">
          {clipboardLabel} {tr('tableLayout.clipboardHint')}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-5">
          <div
            ref={canvasRef}
            onDragOver={(e) => canManage && e.preventDefault()}
            onDrop={canManage ? onDrop : undefined}
            className="relative overflow-hidden rounded-2xl border-[1.5px] border-dashed border-border"
            style={{
              width: TABLE_LAYOUT_CANVAS_WIDTH,
              height: TABLE_LAYOUT_CANVAS_HEIGHT,
              backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          >
            {items === null && !error && (
              <div className="p-5 text-[12.5px] text-muted-foreground">{tr('tableLayout.loading')}</div>
            )}
            {items?.map((t) => {
              const isSel = t.id === selectedId;
              const isTable = t.kind === 'table';
              const dirty = isNewItem(t.id) || dirtyIds.has(t.id);
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
                  {dirty && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" title={tr('tableLayout.unsavedIndicator')} />
                  )}
                  <div className="px-1 text-center text-[13px] font-bold leading-tight">{t.table_code}</div>
                  {isTable && <div className="text-[10.5px] opacity-85">{tr('settings.handy.seatsCount', { n: t.seats })}</div>}
                  {!isTable && <div className="text-[10px] opacity-75">{kindMeta(t.kind, tr).label}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex w-[280px] flex-col gap-3.5 overflow-auto border-l border-border p-4.5">
          {selected ? (
            <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tr('tableLayout.selectedKindHeading', { kind: kindMeta(selected.kind, tr).label })}
              </div>
              <div>
                <div className="mb-1 text-[11.5px] text-muted-foreground">{tr('tableLayout.nameLabel')}</div>
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
                  <div className="mb-1 text-[11.5px] text-muted-foreground">{tr('tableLayout.seatsLabel')}</div>
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
                <div className="mb-1 text-[11.5px] text-muted-foreground">{tr('tableLayout.sizeLabel')}</div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => resizeSelected(-8, 0)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[26px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={widthDraft}
                    onChange={(e) => setWidthDraft(e.target.value)}
                    onBlur={() => commitSize('width')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    disabled={!canManage}
                    min={24}
                    max={600}
                    className="h-[30px] w-14 rounded-lg border border-border px-1.5 text-center text-[12.5px] disabled:opacity-60"
                  />
                  <button
                    onClick={() => resizeSelected(8, 0)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[26px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    ＋
                  </button>
                  <span className="px-0.5 text-muted-foreground">×</span>
                  <button
                    onClick={() => resizeSelected(0, -8)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[26px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={heightDraft}
                    onChange={(e) => setHeightDraft(e.target.value)}
                    onBlur={() => commitSize('height')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    disabled={!canManage}
                    min={24}
                    max={600}
                    className="h-[30px] w-14 rounded-lg border border-border px-1.5 text-center text-[12.5px] disabled:opacity-60"
                  />
                  <button
                    onClick={() => resizeSelected(0, 8)}
                    disabled={!canManage}
                    className="flex h-[30px] w-[26px] items-center justify-center rounded-lg border border-border text-xs disabled:opacity-50"
                  >
                    ＋
                  </button>
                </div>
              </div>

              {canManage && (
                <div className="flex gap-2">
                  <button
                    onClick={copySelected}
                    className="h-[38px] flex-1 rounded-lg border border-border text-[12.5px] font-semibold"
                  >
                    {tr('tableLayout.copyLabel')}
                  </button>
                  <button
                    onClick={deleteSelected}
                    className="h-[38px] flex-1 rounded-lg border border-destructive text-[12.5px] font-semibold text-destructive"
                  >
                    {tr('tableLayout.deleteLabel')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="px-0.5 py-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {tr('tableLayout.instructions')}
            </div>
          )}

          <div className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
            {tr('tableLayout.footerNote')}
          </div>
        </div>
      </div>
    </div>
  );
}
