'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_SETTINGS, type PosSettings } from '@/lib/pos-types';
import { getPosSettings, updatePosSettings, PosApiError } from '@/lib/api-client';
import {
  getGeneralSettings,
  getIntegrationSettings,
  updateGeneralSettings,
  updateIntegrationSettings,
  PosSettingsApiError,
  type IntegrationMode,
} from '@/lib/settings-client';
import { useStaff } from './staff-context';
import {
  createStaff,
  listStaff,
  resetStaffPin,
  PosStaffApiError,
  type PosStaffMember,
  type PosStaffRole,
} from '@/lib/staff-client';
import {
  createMenuCategory,
  createMenuItem,
  createMenuOptionChoice,
  createMenuOptionGroup,
  deleteMenuCategory,
  deleteMenuItem,
  deleteMenuOptionChoice,
  deleteMenuOptionGroup,
  listMenuCategories,
  listMenuItems,
  listMenuOptionGroups,
  renameMenuCategory,
  updateMenuItem,
  updateMenuOptionChoice,
  updateMenuOptionGroup,
  uploadMenuItemImage,
  deleteMenuItemImage,
  PosMenuApiError,
  type PosMenuCategory,
  type PosMenuItemRecord,
  type PosMenuOptionChoice,
  type PosMenuOptionGroup,
} from '@/lib/menu-client';
import { indexCategories, resolveCategoryChain, type CategoryNode } from '@/lib/category-tree';

type Tab = 'general' | 'printer' | 'payment' | 'staff' | 'menu' | 'layout' | 'integration';

const NAV: { key: Tab; label: string }[] = [
  { key: 'general', label: '一般設定' },
  { key: 'printer', label: 'プリンター設定' },
  { key: 'payment', label: '決済設定' },
  { key: 'staff', label: 'スタッフ管理' },
  { key: 'menu', label: 'メニュー・商品オプション' },
  { key: 'layout', label: 'テーブルレイアウト' },
  { key: 'integration', label: '連携設定' },
];

const PRINTERS = [
  { name: 'レシートプリンター', desc: 'レジ横 ・ USB接続', ok: true },
  { name: 'キッチンプリンター', desc: '厨房 ・ LAN接続', ok: true },
];

const ROLE_LABEL: Record<PosStaffRole, string> = { owner: 'オーナー', manager: 'マネージャー', staff: 'スタッフ' };

// GET/PUT /api/pos/settings (integration-spec.md 4.2) に対応する画面。
// dine 連携店舗 (authMode 'dine') は matsunoya-dine 側の /api/pos/settings (api-client.ts) が
// Source of Truth。POS ネイティブ店舗 (authMode 'pos_native') は /api/settings/general
// (pos.stores.settings) に保存する。既存の dine 連携動作は変えない。
export function SettingsScreen() {
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManageSettings = !isPosNative || me.role === 'owner' || me.role === 'manager';

  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = isPosNative ? await getGeneralSettings() : await getPosSettings();
        if (!cancelled) setSettings((prev) => ({ ...prev, ...s }));
      } catch {
        // 取得に失敗しても DEFAULT_SETTINGS のまま編集は続けられる。保存時にエラーを出す。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPosNative]);

  function update<K extends keyof PosSettings>(key: K, value: PosSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      if (isPosNative) {
        const {
          vatRate,
          vatInclusive,
          serviceRate,
          khrRate,
          cashEnabled,
          qrEnabled,
          cardEnabled,
          happyHourEnabled,
          happyHourStart,
          happyHourEnd,
        } = settings;
        const s = await updateGeneralSettings({
          vatRate,
          vatInclusive,
          serviceRate,
          khrRate,
          cashEnabled,
          qrEnabled,
          cardEnabled,
          happyHourEnabled,
          happyHourStart,
          happyHourEnd,
        });
        setSettings((prev) => ({ ...prev, ...s }));
      } else {
        const { vatRate, serviceRate, khrRate, cashEnabled, qrEnabled, cardEnabled } = settings;
        const s = await updatePosSettings({ vatRate, serviceRate, khrRate, cashEnabled, qrEnabled, cardEnabled });
        setSettings((prev) => ({ ...prev, ...s }));
      }
      setSaved(true);
    } catch (err) {
      const message =
        err instanceof PosSettingsApiError || err instanceof PosApiError ? err.message : '保存に失敗しました';
      setSaveError(message);
    } finally {
      setSaving(false);
    }
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
            <div className="text-base font-bold">設定</div>
            <div className="text-xs text-muted-foreground">店舗の各種設定を管理します</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {saveError && <div className="text-xs text-destructive">{saveError}</div>}
          {(tab === 'general' || tab === 'payment') && (
            <button
              onClick={handleSave}
              disabled={saving || !canManageSettings}
              className={
                'h-10 rounded-lg px-4.5 text-[13.5px] font-bold disabled:opacity-60 ' +
                (saved ? 'bg-emerald-100 text-emerald-600' : 'bg-primary text-primary-foreground')
              }
            >
              {saving ? '保存中…' : saved ? '保存しました ✓' : '保存'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-[220px] flex-col gap-0.5 overflow-auto border-r border-border p-2.5">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className={
                'h-10 rounded-lg px-3.5 text-left text-[13px] font-semibold ' +
                (tab === n.key ? 'bg-secondary text-foreground' : 'text-muted-foreground')
              }
            >
              {n.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto px-8 py-6">
          {tab === 'general' && (
            <div className="flex max-w-[520px] flex-col gap-5">
              <div className="text-[15px] font-bold">一般設定</div>
              {!canManageSettings && (
                <div className="rounded-xl border border-border p-3 text-[12.5px] text-muted-foreground">
                  一般設定の変更には manager 以上の権限が必要です。
                </div>
              )}
              <Field label="VAT率 (%)">
                <input
                  value={settings.vatRate}
                  disabled={!canManageSettings}
                  onChange={(e) => update('vatRate', parseFloat(e.target.value) || 0)}
                  className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px] disabled:opacity-60"
                />
              </Field>
              {isPosNative && (
                <Field label="VATの扱い">
                  <div className="flex w-fit gap-1.5 rounded-lg bg-secondary p-1">
                    <button
                      type="button"
                      disabled={!canManageSettings}
                      onClick={() => update('vatInclusive', false)}
                      className={
                        'h-9 rounded-md px-4 text-[12.5px] font-semibold disabled:opacity-60 ' +
                        (!settings.vatInclusive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
                      }
                    >
                      税別 (外税)
                    </button>
                    <button
                      type="button"
                      disabled={!canManageSettings}
                      onClick={() => update('vatInclusive', true)}
                      className={
                        'h-9 rounded-md px-4 text-[12.5px] font-semibold disabled:opacity-60 ' +
                        (settings.vatInclusive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
                      }
                    >
                      税込み (内税)
                    </button>
                  </div>
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    税別: メニュー価格にVATを上乗せして合計を計算します。税込み: メニュー価格に既にVATが含まれているものとして扱い、VAT額は内訳表示のみで合計には加算しません(サービス料は税別・税込みどちらでも合計に加算されます)。
                  </div>
                </Field>
              )}
              <Field label="サービス料率 (%)">
                <input
                  value={settings.serviceRate}
                  disabled={!canManageSettings}
                  onChange={(e) => update('serviceRate', parseFloat(e.target.value) || 0)}
                  className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px] disabled:opacity-60"
                />
              </Field>
              <Field label="参考為替レート (1 USD = ? KHR)">
                <input
                  value={settings.khrRate}
                  disabled={!canManageSettings}
                  onChange={(e) => update('khrRate', parseInt(e.target.value, 10) || 0)}
                  className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px] disabled:opacity-60"
                />
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  レジ締め・会計画面のKHR自動計算に使用されます。日次で更新してください。
                </div>
              </Field>

              {isPosNative && (
                <>
                  <div className="mt-2 border-t border-border pt-4 text-[13.5px] font-bold">
                    ハッピーアワー (時間帯価格)
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">
                    対象商品(生ビール グラス・ARAWAZA・DAIYAME・いいちこ・カンポットハイボール)は、下記の時間帯のみ自動で割引価格になります。
                  </div>
                  <ToggleRow
                    name="ハッピーアワーを有効にする"
                    desc="OFFにすると時間帯にかかわらず通常価格のまま"
                    on={settings.happyHourEnabled}
                    disabled={!canManageSettings}
                    onToggle={() => update('happyHourEnabled', !settings.happyHourEnabled)}
                  />
                  <div className="flex items-center gap-3">
                    <Field label="開始時刻">
                      <input
                        type="time"
                        value={settings.happyHourStart}
                        disabled={!canManageSettings || !settings.happyHourEnabled}
                        onChange={(e) => update('happyHourStart', e.target.value)}
                        className="h-10 w-36 rounded-lg border border-border px-3 text-[13.5px] disabled:opacity-60"
                      />
                    </Field>
                    <Field label="終了時刻">
                      <input
                        type="time"
                        value={settings.happyHourEnd}
                        disabled={!canManageSettings || !settings.happyHourEnabled}
                        onChange={(e) => update('happyHourEnd', e.target.value)}
                        className="h-10 w-36 rounded-lg border border-border px-3 text-[13.5px] disabled:opacity-60"
                      />
                    </Field>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'printer' && (
            <div className="flex max-w-[560px] flex-col gap-3.5">
              <div className="text-[15px] font-bold">プリンター設定</div>
              {PRINTERS.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between rounded-xl border border-border px-4 py-3.5"
                >
                  <div>
                    <div className="text-[13.5px] font-semibold">{p.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">{p.desc}</div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className={'flex items-center gap-1.5 text-xs ' + (p.ok ? 'text-emerald-600' : 'text-destructive')}>
                      <span className={'inline-block h-2 w-2 rounded-full ' + (p.ok ? 'bg-emerald-500' : 'bg-destructive')} />
                      {p.ok ? '接続中' : '未接続'}
                    </div>
                    <button className="h-[34px] rounded-lg border border-border px-3.5 text-[12.5px] font-semibold">
                      テスト印刷
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'payment' && (
            <div className="flex max-w-[560px] flex-col gap-2.5">
              <div className="mb-1.5 text-[15px] font-bold">決済設定</div>
              {!canManageSettings && (
                <div className="mb-1 rounded-xl border border-border p-3 text-[12.5px] text-muted-foreground">
                  決済設定の変更には manager 以上の権限が必要です。
                </div>
              )}
              <ToggleRow
                name="現金"
                desc="USD / KHR 混在対応"
                on={settings.cashEnabled}
                disabled={!canManageSettings}
                onToggle={() => update('cashEnabled', !settings.cashEnabled)}
              />
              <ToggleRow
                name="QR (ABA/KHQR)"
                desc="静的QR表示・手動確認"
                on={settings.qrEnabled}
                disabled={!canManageSettings}
                onToggle={() => update('qrEnabled', !settings.qrEnabled)}
              />
              <ToggleRow
                name="カード"
                desc="外部端末決済・手動記録"
                on={settings.cardEnabled}
                disabled={!canManageSettings}
                onToggle={() => update('cardEnabled', !settings.cardEnabled)}
              />
            </div>
          )}

          {tab === 'staff' && <StaffTab />}

          {tab === 'menu' && <MenuTab />}

          {tab === 'layout' && (
            <InfoNote
              title="テーブルレイアウト"
              body="卓の配置・卓番号・席数は専用のレイアウト編集画面から変更できます。柱・カウンターなどの障害物の追加や、卓・障害物の大きさ変更もできます。"
              cta="レイアウト編集を開く"
              onCta={() => router.push('/pos/table-layout')}
            />
          )}

          {tab === 'integration' && <IntegrationTab />}
        </div>
      </div>
    </div>
  );
}

// スタッフ管理タブ: pos.staff の実データを CRUD する (POS ネイティブ PIN ログイン用)。
// API 側は manager 以上のみ許可しているので、こちらは UI 側の補助的なガード。
function StaffTab() {
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = isPosNative && (me.role === 'owner' || me.role === 'manager');

  const [staffList, setStaffList] = useState<PosStaffMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    listStaff()
      .then(({ staff }) => setStaffList(staff))
      .catch((err) => {
        setLoadError(err instanceof PosStaffApiError ? err.message : 'スタッフ一覧の取得に失敗しました');
      });
  }, []);

  useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  if (!isPosNative) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3.5">
        <div className="text-[15px] font-bold">スタッフ管理</div>
        <PinLoginRequiredNote />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3.5">
        <div className="text-[15px] font-bold">スタッフ管理</div>
        <div className="rounded-xl border border-border p-4 text-[13px] text-muted-foreground">
          スタッフ管理には manager 以上の権限が必要です。
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[15px] font-bold">スタッフ管理 (POS PINログイン)</div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="h-9 rounded-lg border border-dashed border-brand px-3.5 text-[12.5px] font-semibold text-brand"
        >
          {showAddForm ? 'キャンセル' : '＋ スタッフを追加'}
        </button>
      </div>

      {showAddForm && (
        <AddStaffForm
          onCreated={() => {
            setShowAddForm(false);
            load();
          }}
        />
      )}

      {loadError && <div className="text-xs text-destructive">{loadError}</div>}
      {staffList === null && !loadError && <div className="text-xs text-muted-foreground">読み込み中…</div>}
      {staffList?.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground">
          登録済みのPOSスタッフがいません。「＋ スタッフを追加」から登録してください。
        </div>
      )}

      {staffList?.map((s) => (
        <div key={s.id} className="rounded-xl border border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                {s.display_name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="text-[13px] font-semibold">{s.display_name}</div>
                <div className="text-[11.5px] text-muted-foreground">
                  {ROLE_LABEL[s.role]}
                  {s.active === false && ' ・ 無効'}
                </div>
              </div>
            </div>
            <button
              onClick={() => setResetTargetId((v) => (v === s.id ? null : s.id))}
              className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
            >
              PINをリセット
            </button>
          </div>
          {resetTargetId === s.id && (
            <ResetPinForm
              staffId={s.id}
              onDone={() => setResetTargetId(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function AddStaffForm({ onCreated }: { onCreated: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<PosStaffRole>('staff');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || pin.length < 4) return;
    setSubmitting(true);
    setError(null);
    try {
      await createStaff({ displayName: displayName.trim(), role, pin });
      onCreated();
    } catch (err) {
      setError(err instanceof PosStaffApiError ? err.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex gap-2.5">
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="氏名"
          className="h-10 flex-1 rounded-lg border border-border px-3 text-[13.5px]"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as PosStaffRole)}
          className="h-10 w-36 rounded-lg border border-border px-3 text-[13.5px]"
        >
          <option value="staff">スタッフ</option>
          <option value="manager">マネージャー</option>
          <option value="owner">オーナー</option>
        </select>
      </div>
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
        placeholder="初期PIN (4〜8桁の数字)"
        className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px]"
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <button
        type="submit"
        disabled={submitting || !displayName.trim() || pin.length < 4}
        className="h-9 w-fit rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? '登録中…' : '登録する'}
      </button>
    </form>
  );
}

function ResetPinForm({ staffId, onDone }: { staffId: string; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) return;
    setSubmitting(true);
    setError(null);
    try {
      await resetStaffPin(staffId, pin);
      onDone();
    } catch (err) {
      setError(err instanceof PosStaffApiError ? err.message : 'リセットに失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex items-center gap-2 border-t border-border pt-3">
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
        placeholder="新しいPIN"
        className="h-9 w-36 rounded-lg border border-border px-3 text-[13px]"
      />
      <button
        type="submit"
        disabled={submitting || pin.length < 4}
        className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? '更新中…' : '更新'}
      </button>
      <button type="button" onClick={onDone} className="h-9 rounded-lg border border-border px-3 text-xs font-semibold">
        キャンセル
      </button>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </form>
  );
}

// メニュー・商品オプションタブ: pos.menu_categories / pos.menu_items の実データを CRUD する
// (POS単体運用モード用。matsunoya-dine 連携店舗は matsunoya-dine 管理画面が編集元のまま)。
// API 側は manager 以上のみ許可しているので、こちらは UI 側の補助的なガード。
function MenuTab() {
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = isPosNative && (me.role === 'owner' || me.role === 'manager');

  const [categories, setCategories] = useState<PosMenuCategory[] | null>(null);
  const [items, setItems] = useState<PosMenuItemRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [optionsItemId, setOptionsItemId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'category' | 'flat'>('category');

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([listMenuCategories(), listMenuItems()])
      .then(([c, i]) => {
        setCategories(c.categories);
        setItems(i.items);
      })
      .catch((err) => {
        setLoadError(err instanceof PosMenuApiError ? err.message : 'メニューの取得に失敗しました');
      });
  }, []);

  useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  if (!isPosNative) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3.5">
        <div className="text-[15px] font-bold">メニュー・商品オプション</div>
        <PinLoginRequiredNote />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3.5">
        <div className="text-[15px] font-bold">メニュー・商品オプション</div>
        <div className="rounded-xl border border-border p-4 text-[13px] text-muted-foreground">
          メニュー管理には manager 以上の権限が必要です。
        </div>
      </div>
    );
  }

  const categoryName = (id: string | null) => {
    if (!id || !categories) return '未分類';
    const resolved = resolveCategoryChain(id, indexCategories(categories as CategoryNode[]));
    if (!resolved) return '(不明なカテゴリ)';
    const parts = [resolved.majorName];
    if (resolved.middleName) parts.push(resolved.middleName);
    if (resolved.minorName !== resolved.majorName && resolved.minorName !== resolved.middleName) parts.push(resolved.minorName);
    return parts.join(' > ');
  };

  async function handleDeleteCategory(id: string) {
    try {
      await deleteMenuCategory(id);
      load();
    } catch (err) {
      setLoadError(err instanceof PosMenuApiError ? err.message : 'カテゴリの削除に失敗しました');
    }
  }

  async function handleToggleActive(item: PosMenuItemRecord) {
    try {
      await updateMenuItem(item.id, { active: !item.active });
      load();
    } catch (err) {
      setLoadError(err instanceof PosMenuApiError ? err.message : '更新に失敗しました');
    }
  }

  async function handleDeleteItem(id: string) {
    try {
      await deleteMenuItem(id);
      load();
    } catch (err) {
      setLoadError(err instanceof PosMenuApiError ? err.message : '商品の削除に失敗しました');
    }
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-8">
      <div>
        <div className="text-[15px] font-bold">メニュー・商品オプション</div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          POS単体で運用する店舗向けの設定です。matsunoya-dine と連携している店舗は matsunoya-dine 管理画面が編集元です。
        </div>
      </div>

      {loadError && <div className="text-xs text-destructive">{loadError}</div>}

      {/* カテゴリ (大→中→小の3階層) */}
      <div className="flex flex-col gap-2.5">
        <div className="mb-0.5 flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">カテゴリ (大 &gt; 中 &gt; 小)</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              レジ画面には大カテゴリーがタブとして表示されます。中カテゴリーはタブの中の見出しになります (無くても登録可)。
            </div>
          </div>
          <button
            onClick={() => setShowAddCategory((v) => !v)}
            className="h-8 flex-shrink-0 rounded-lg border border-dashed border-brand px-3 text-[12px] font-semibold text-brand"
          >
            {showAddCategory ? 'キャンセル' : '＋ 大カテゴリーを追加'}
          </button>
        </div>

        {showAddCategory && (
          <AddCategoryForm
            parentId={null}
            placeholder="大カテゴリー名 (例: ドリンク)"
            onCreated={() => {
              setShowAddCategory(false);
              load();
            }}
          />
        )}

        {categories === null && !loadError && <div className="text-xs text-muted-foreground">読み込み中…</div>}
        {categories?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground">
            カテゴリが未登録です。「＋ 大カテゴリーを追加」から登録してください。
          </div>
        )}
        {categories && categories.length > 0 && (
          <CategoryTree categories={categories} onDelete={handleDeleteCategory} onChanged={load} />
        )}
      </div>

      {/* 商品 */}
      <div className="flex flex-col gap-2.5">
        <div className="mb-0.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-[13.5px] font-bold">商品一覧</div>
            {items && items.length > 0 && (
              <div className="flex w-fit gap-1 rounded-lg bg-secondary p-0.5">
                <button
                  onClick={() => setViewMode('category')}
                  className={
                    'h-7 rounded-md px-2.5 text-[11.5px] font-semibold ' +
                    (viewMode === 'category' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
                  }
                >
                  カテゴリ別
                </button>
                <button
                  onClick={() => setViewMode('flat')}
                  className={
                    'h-7 rounded-md px-2.5 text-[11.5px] font-semibold ' +
                    (viewMode === 'flat' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
                  }
                >
                  一覧
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowAddItem((v) => !v)}
            disabled={!categories}
            className="h-8 rounded-lg border border-dashed border-brand px-3 text-[12px] font-semibold text-brand disabled:opacity-50"
          >
            {showAddItem ? 'キャンセル' : '＋ 商品を追加'}
          </button>
        </div>

        {showAddItem && categories && (
          <AddItemForm
            categories={categories}
            onCategoriesChanged={load}
            onCreated={() => {
              setShowAddItem(false);
              load();
            }}
          />
        )}

        {items === null && !loadError && <div className="text-xs text-muted-foreground">読み込み中…</div>}
        {items?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-[13px] text-muted-foreground">
            商品が未登録です。「＋ 商品を追加」から登録してください。
          </div>
        )}

        {items && items.length > 0 && categories && viewMode === 'category'
          ? [...categories, null].map((c) => {
              const groupItems = items.filter((it) => it.category_id === (c ? c.id : null) || (c === null && !categories.some((cc) => cc.id === it.category_id)));
              if (groupItems.length === 0) return null;
              return (
                <div key={c ? c.id : 'uncategorized'} className="flex flex-col gap-2">
                  <div className="mt-1 text-[12px] font-bold text-muted-foreground">{c ? categoryName(c.id) : '未分類'}</div>
                  {groupItems.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      categories={categories}
                      categoryName={categoryName}
                      isEditing={editingItemId === item.id}
                      showOptions={optionsItemId === item.id}
                      onToggleActive={() => handleToggleActive(item)}
                      onToggleEdit={() => setEditingItemId((v) => (v === item.id ? null : item.id))}
                      onToggleOptions={() => setOptionsItemId((v) => (v === item.id ? null : item.id))}
                      onDelete={() => handleDeleteItem(item.id)}
                      onEditDone={() => {
                        setEditingItemId(null);
                        load();
                      }}
                      onRefresh={load}
                      onCategoriesChanged={load}
                    />
                  ))}
                </div>
              );
            })
          : items?.map((item) => (
              <MenuItemRow
                key={item.id}
                item={item}
                categories={categories ?? []}
                categoryName={categoryName}
                isEditing={editingItemId === item.id}
                showOptions={optionsItemId === item.id}
                onToggleActive={() => handleToggleActive(item)}
                onToggleEdit={() => setEditingItemId((v) => (v === item.id ? null : item.id))}
                onToggleOptions={() => setOptionsItemId((v) => (v === item.id ? null : item.id))}
                onDelete={() => handleDeleteItem(item.id)}
                onEditDone={() => {
                  setEditingItemId(null);
                  load();
                }}
                onRefresh={load}
                onCategoriesChanged={load}
              />
            ))}
      </div>
    </div>
  );
}

function MenuItemRow({
  item,
  categories,
  categoryName,
  isEditing,
  showOptions,
  onToggleActive,
  onToggleEdit,
  onToggleOptions,
  onDelete,
  onEditDone,
  onRefresh,
  onCategoriesChanged,
}: {
  item: PosMenuItemRecord;
  categories: PosMenuCategory[];
  categoryName: (id: string | null) => string;
  isEditing: boolean;
  showOptions: boolean;
  onToggleActive: () => void;
  onToggleEdit: () => void;
  onToggleOptions: () => void;
  onDelete: () => void;
  onEditDone: () => void;
  onRefresh: () => void;
  onCategoriesChanged: () => void;
}) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary text-muted-foreground">
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-base">🍽</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className={'truncate text-[13px] font-semibold ' + (item.active ? '' : 'text-muted-foreground line-through')}>
                {item.name}
              </div>
              {!item.active && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">非表示</span>
              )}
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              {categoryName(item.category_id)} ・ ${item.price.toFixed(2)}
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={onToggleActive}
            className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
          >
            {item.active ? '非表示にする' : '再表示する'}
          </button>
          <button
            onClick={onToggleEdit}
            className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
          >
            編集
          </button>
          <button
            onClick={onToggleOptions}
            className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
          >
            オプション
          </button>
          <button
            onClick={onDelete}
            className="h-8 rounded-lg border border-border px-3 text-xs font-semibold text-destructive"
          >
            削除
          </button>
        </div>
      </div>
      {isEditing && (
        <EditItemForm
          item={item}
          categories={categories}
          onDone={onEditDone}
          onRefresh={onRefresh}
          onCategoriesChanged={onCategoriesChanged}
        />
      )}
      {showOptions && <OptionGroupsPanel itemId={item.id} />}
    </div>
  );
}

function AddCategoryForm({
  parentId,
  placeholder,
  onCreated,
}: {
  parentId: string | null;
  placeholder?: string;
  onCreated: (category: PosMenuCategory) => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const { category } = await createMenuCategory(name.trim(), parentId);
      onCreated(category);
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/40 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder ?? 'カテゴリ名'}
        className="h-9 flex-1 rounded-lg border border-border px-3 text-[13px]"
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="h-9 rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? '登録中…' : '登録'}
      </button>
    </form>
  );
}

// 大カテゴリー → 中カテゴリー → 小カテゴリー の3階層ツリー表示。
// 既存の店舗はカテゴリが全て大カテゴリー (parent_id が null) のままなので、その場合は
// 各大カテゴリーの下に「＋中/小カテゴリーを追加」が出るだけの見た目になる (今まで通り)。
function CategoryTree({
  categories,
  onDelete,
  onChanged,
}: {
  categories: PosMenuCategory[];
  onDelete: (id: string) => void;
  onChanged: () => void;
}) {
  const [addingUnder, setAddingUnder] = useState<string | null>(null);

  const byParent = new Map<string | null, PosMenuCategory[]>();
  for (const c of categories) {
    const key = c.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const majors = byParent.get(null) ?? [];

  function childrenOf(id: string) {
    return byParent.get(id) ?? [];
  }

  function toggleAdding(id: string) {
    setAddingUnder((v) => (v === id ? null : id));
  }

  return (
    <div className="flex flex-col gap-3">
      {majors.map((major) => {
        const middles = childrenOf(major.id);
        return (
          <div key={major.id} className="rounded-xl border border-border p-3.5">
            <div className="flex items-center justify-between gap-2">
              <CategoryChip category={major} onRenamed={onChanged} onDelete={() => onDelete(major.id)} />
              <button
                onClick={() => toggleAdding(major.id)}
                className="h-7 flex-shrink-0 rounded-lg border border-dashed border-brand px-2.5 text-[11px] font-semibold text-brand"
              >
                {addingUnder === major.id ? 'キャンセル' : '＋ 中/小カテゴリーを追加'}
              </button>
            </div>

            {addingUnder === major.id && (
              <div className="mt-2.5">
                <AddCategoryForm
                  parentId={major.id}
                  placeholder="中または小カテゴリー名 (例: 焼酎)"
                  onCreated={() => {
                    setAddingUnder(null);
                    onChanged();
                  }}
                />
              </div>
            )}

            {middles.length > 0 && (
              <div className="mt-3 flex flex-col gap-2.5 border-l-2 border-border pl-3.5">
                {middles.map((middle) => {
                  const minors = childrenOf(middle.id);
                  return (
                    <div key={middle.id}>
                      <div className="flex items-center justify-between gap-2">
                        <CategoryChip category={middle} onRenamed={onChanged} onDelete={() => onDelete(middle.id)} />
                        <button
                          onClick={() => toggleAdding(middle.id)}
                          className="h-6 flex-shrink-0 rounded-lg border border-dashed border-brand px-2 text-[10.5px] font-semibold text-brand"
                        >
                          {addingUnder === middle.id ? 'キャンセル' : '＋ 小カテゴリーを追加'}
                        </button>
                      </div>

                      {addingUnder === middle.id && (
                        <div className="mt-2">
                          <AddCategoryForm
                            parentId={middle.id}
                            placeholder="小カテゴリー名 (例: iichiko)"
                            onCreated={() => {
                              setAddingUnder(null);
                              onChanged();
                            }}
                          />
                        </div>
                      )}

                      {minors.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 border-l-2 border-border pl-3.5">
                          {minors.map((minor) => (
                            <CategoryChip key={minor.id} category={minor} onRenamed={onChanged} onDelete={() => onDelete(minor.id)} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CategoryChip({
  category,
  onRenamed,
  onDelete,
}: {
  category: PosMenuCategory;
  onRenamed: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === category.name) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    try {
      await renameMenuCategory(category.id, name.trim());
      setEditing(false);
      onRenamed();
    } catch {
      // 失敗時は元の名前に戻す (エラーは上位の loadError には出さず、ここではシンプルに黙って戻す)
      setName(category.name);
    } finally {
      setSubmitting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={submit}
          className="h-6 w-28 rounded border border-border px-1.5 text-[12px]"
        />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1.5">
      <button onClick={() => setEditing(true)} disabled={submitting} className="text-[12.5px] font-semibold">
        {category.name}
      </button>
      <button
        onClick={onDelete}
        className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-muted-foreground hover:text-destructive"
        title="カテゴリを削除"
      >
        ×
      </button>
    </div>
  );
}

function AddItemForm({
  categories,
  onCreated,
  onCategoriesChanged,
}: {
  categories: PosMenuCategory[];
  onCreated: () => void;
  onCategoriesChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceValue = parseFloat(price);
    if (!name.trim() || !Number.isFinite(priceValue) || priceValue < 0 || !categoryId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMenuItem({ categoryId, name: name.trim(), price: priceValue });
      onCreated();
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 rounded-xl border border-border bg-secondary/40 p-4">
      <div className="flex gap-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="商品名"
          className="h-10 flex-1 rounded-lg border border-border px-3 text-[13.5px]"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder="価格 ($)"
          className="h-10 w-28 rounded-lg border border-border px-3 text-[13.5px]"
        />
      </div>
      <CategoryCascadeSelect categories={categories} value={categoryId} onChange={setCategoryId} onCategoriesChanged={onCategoriesChanged} />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <button
        type="submit"
        disabled={submitting || !name.trim() || !price || !categoryId}
        className="h-9 w-fit rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
      >
        {submitting ? '登録中…' : '登録する'}
      </button>
    </form>
  );
}

// 大 → 中(任意) → 小(必須) のカスケード選択。中カテゴリーを選ばない場合、小カテゴリーの
// 選択肢には大カテゴリー直下の全カテゴリー (中として作られたものも、中を介さない小として
// 作られたものも両方) を並べる。選択肢が無い大カテゴリーではその場で小カテゴリーを新規作成できる。
function CategoryCascadeSelect({
  categories,
  value,
  onChange,
  onCategoriesChanged,
}: {
  categories: PosMenuCategory[];
  value: string;
  onChange: (leafId: string) => void;
  onCategoriesChanged: () => void;
}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sortFn = (a: PosMenuCategory, b: PosMenuCategory) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const majors = categories.filter((c) => !c.parent_id).sort(sortFn);
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id).sort(sortFn);

  function chainOf(id: string): { majorId: string; middleId: string } {
    const leaf = id ? byId.get(id) : undefined;
    if (!leaf) return { majorId: '', middleId: '' };
    const parent = leaf.parent_id ? byId.get(leaf.parent_id) : undefined;
    if (!parent) return { majorId: leaf.id, middleId: '' };
    const grandparent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
    if (!grandparent) return { majorId: parent.id, middleId: '' };
    return { majorId: grandparent.id, middleId: parent.id };
  }

  const initial = chainOf(value);
  const [majorId, setMajorId] = useState(initial.majorId || majors[0]?.id || '');
  const [middleId, setMiddleId] = useState(initial.middleId);
  const [showAddMinor, setShowAddMinor] = useState(false);

  const middleOptions = majorId ? childrenOf(majorId) : [];
  const minorOptions = middleId ? childrenOf(middleId) : middleOptions.flatMap((m) => [m, ...childrenOf(m.id)]);
  const minorValue = minorOptions.some((c) => c.id === value) ? value : '';

  function handleMajorChange(id: string) {
    setMajorId(id);
    setMiddleId('');
    setShowAddMinor(false);
    onChange('');
  }
  function handleMiddleChange(id: string) {
    setMiddleId(id);
    setShowAddMinor(false);
    onChange('');
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <select
          value={majorId}
          onChange={(e) => handleMajorChange(e.target.value)}
          className="h-9 flex-1 rounded-lg border border-border px-2 text-[12.5px]"
        >
          <option value="" disabled>
            大カテゴリー
          </option>
          {majors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={middleId}
          onChange={(e) => handleMiddleChange(e.target.value)}
          disabled={!majorId}
          className="h-9 flex-1 rounded-lg border border-border px-2 text-[12.5px] disabled:opacity-50"
        >
          <option value="">(中カテゴリーなし)</option>
          {middleOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={minorValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={!majorId}
          className="h-9 flex-1 rounded-lg border border-border px-2 text-[12.5px] disabled:opacity-50"
        >
          <option value="" disabled>
            小カテゴリー
          </option>
          {minorOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {majorId && minorOptions.length === 0 && !showAddMinor && (
        <button
          type="button"
          onClick={() => setShowAddMinor(true)}
          className="w-fit text-[11px] font-semibold text-brand"
        >
          この大カテゴリーには小カテゴリーがまだありません。＋ 追加する
        </button>
      )}
      {showAddMinor && majorId && (
        <AddCategoryForm
          parentId={middleId || majorId}
          placeholder="小カテゴリー名"
          onCreated={(cat) => {
            setShowAddMinor(false);
            onChange(cat.id);
            onCategoriesChanged();
          }}
        />
      )}
    </div>
  );
}

function EditItemForm({
  item,
  categories,
  onDone,
  onRefresh,
  onCategoriesChanged,
}: {
  item: PosMenuItemRecord;
  categories: PosMenuCategory[];
  onDone: () => void;
  onRefresh: () => void;
  onCategoriesChanged: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));
  const [categoryId, setCategoryId] = useState<string>(item.category_id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(item.image_url);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceValue = parseFloat(price);
    if (!name.trim() || !Number.isFinite(priceValue) || priceValue < 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateMenuItem(item.id, { name: name.trim(), price: priceValue, categoryId: categoryId || null });
      onDone();
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : '更新に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageUploading(true);
    setImageError(null);
    try {
      const { item: updated } = await uploadMenuItemImage(item.id, file);
      setImageUrl(updated.image_url);
      onRefresh();
    } catch (err) {
      setImageError(err instanceof PosMenuApiError ? err.message : '画像のアップロードに失敗しました');
    } finally {
      setImageUploading(false);
    }
  }

  async function handleImageRemove() {
    setImageUploading(true);
    setImageError(null);
    try {
      const { item: updated } = await deleteMenuItemImage(item.id);
      setImageUrl(updated.image_url);
      onRefresh();
    } catch (err) {
      setImageError(err instanceof PosMenuApiError ? err.message : '画像の削除に失敗しました');
    } finally {
      setImageUploading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary text-muted-foreground">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl">🍽</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <label className="flex h-8 cursor-pointer items-center rounded-lg border border-border px-3 text-xs font-semibold">
              {imageUploading ? 'アップロード中…' : imageUrl ? '画像を変更' : '＋ 画像を追加'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageSelect}
                disabled={imageUploading}
                className="hidden"
              />
            </label>
            {imageUrl && (
              <button
                type="button"
                onClick={handleImageRemove}
                disabled={imageUploading}
                className="h-8 rounded-lg border border-border px-3 text-xs font-semibold text-destructive disabled:opacity-60"
              >
                削除
              </button>
            )}
          </div>
          <div className="text-[10.5px] text-muted-foreground">jpg・png・webp / 3MBまで</div>
          {imageError && <div className="text-[11px] text-destructive">{imageError}</div>}
        </div>
      </div>
      <div className="flex gap-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 flex-1 rounded-lg border border-border px-3 text-[13px]"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          className="h-9 w-24 rounded-lg border border-border px-3 text-[13px]"
        />
      </div>
      <CategoryCascadeSelect categories={categories} value={categoryId} onChange={setCategoryId} onCategoriesChanged={onCategoriesChanged} />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {submitting ? '保存中…' : '保存'}
        </button>
        <button type="button" onClick={onDone} className="h-9 rounded-lg border border-border px-3 text-xs font-semibold">
          キャンセル
        </button>
      </div>
    </form>
  );
}

// 商品オプション (トッピング・量目選択など) のグループ + 選択肢 管理パネル。
// 商品一覧の各行で「オプション」ボタンを押すと展開される。
function OptionGroupsPanel({ itemId }: { itemId: string }) {
  const [groups, setGroups] = useState<PosMenuOptionGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddGroup, setShowAddGroup] = useState(false);

  const load = useCallback(() => {
    setError(null);
    listMenuOptionGroups(itemId)
      .then((res) => setGroups(res.groups))
      .catch((err) => setError(err instanceof PosMenuApiError ? err.message : 'オプションの取得に失敗しました'));
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeleteGroup(groupId: string) {
    try {
      await deleteMenuOptionGroup(itemId, groupId);
      load();
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : 'オプショングループの削除に失敗しました');
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px] font-bold text-muted-foreground">商品オプション (トッピング・量目選択など)</div>
        <button
          onClick={() => setShowAddGroup((v) => !v)}
          className="h-7 rounded-lg border border-dashed border-brand px-2.5 text-[11.5px] font-semibold text-brand"
        >
          {showAddGroup ? 'キャンセル' : '＋ グループを追加'}
        </button>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      {showAddGroup && (
        <AddOptionGroupForm
          itemId={itemId}
          onCreated={() => {
            setShowAddGroup(false);
            load();
          }}
          onCancel={() => setShowAddGroup(false)}
        />
      )}

      {groups === null && !error && <div className="text-xs text-muted-foreground">読み込み中…</div>}
      {groups?.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground">
          オプショングループが未登録です。トッピングや量目選択などが必要な場合は「＋ グループを追加」から登録してください。
        </div>
      )}

      {groups?.map((g) => (
        <OptionGroupCard key={g.id} itemId={itemId} group={g} onChanged={load} onDeleteGroup={() => handleDeleteGroup(g.id)} />
      ))}
    </div>
  );
}

function AddOptionGroupForm({
  itemId,
  onCreated,
  onCancel,
}: {
  itemId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [required, setRequired] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !label.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMenuOptionGroup(itemId, { key: key.trim(), label: label.trim(), required });
      onCreated();
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="キー (例: weight)"
          className="h-8 w-32 rounded-lg border border-border px-2.5 text-[12.5px]"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="表示名 (例: 量目を選択)"
          className="h-8 flex-1 rounded-lg border border-border px-2.5 text-[12.5px]"
        />
        <label className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          必須
        </label>
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !key.trim() || !label.trim()}
          className="h-8 w-fit rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {submitting ? '登録中…' : '登録する'}
        </button>
        <button type="button" onClick={onCancel} className="h-8 rounded-lg border border-border px-3 text-[12px] font-semibold">
          キャンセル
        </button>
      </div>
    </form>
  );
}

function OptionGroupCard({
  itemId,
  group,
  onChanged,
  onDeleteGroup,
}: {
  itemId: string;
  group: PosMenuOptionGroup;
  onChanged: () => void;
  onDeleteGroup: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(group.label);
  const [required, setRequired] = useState(group.required);
  const [submitting, setSubmitting] = useState(false);
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateMenuOptionGroup(itemId, group.id, { label: label.trim(), required });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : '更新に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteChoice(choiceId: string) {
    try {
      await deleteMenuOptionChoice(itemId, group.id, choiceId);
      onChanged();
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : '選択肢の削除に失敗しました');
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <form onSubmit={submitEdit} className="flex flex-1 items-center gap-2">
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border px-2.5 text-[12.5px]"
            />
            <label className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
              必須
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="h-8 rounded-lg bg-primary px-2.5 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-60"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setLabel(group.label);
                setRequired(group.required);
              }}
              className="h-8 rounded-lg border border-border px-2.5 text-[11.5px] font-semibold"
            >
              キャンセル
            </button>
          </form>
        ) : (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setEditing(true)} className="text-[13px] font-semibold">
                {group.label}
              </button>
              {group.required && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">必須</span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">key: {group.key}</div>
          </div>
        )}
        {!editing && (
          <button onClick={onDeleteGroup} className="flex-shrink-0 text-[11.5px] font-semibold text-destructive">
            グループを削除
          </button>
        )}
      </div>

      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}

      <div className="mt-2.5 flex flex-col gap-1.5">
        {group.choices.length === 0 && !showAddChoice && (
          <div className="text-[11.5px] text-muted-foreground">選択肢が未登録です。</div>
        )}
        {group.choices.map((c) => (
          <OptionChoiceRow
            key={c.id}
            itemId={itemId}
            groupId={group.id}
            choice={c}
            onChanged={onChanged}
            onDelete={() => handleDeleteChoice(c.id)}
          />
        ))}
      </div>

      {showAddChoice ? (
        <AddOptionChoiceForm
          itemId={itemId}
          groupId={group.id}
          onCreated={() => {
            setShowAddChoice(false);
            onChanged();
          }}
          onCancel={() => setShowAddChoice(false)}
        />
      ) : (
        <button
          onClick={() => setShowAddChoice(true)}
          className="mt-2 h-7 w-fit rounded-lg border border-dashed border-brand px-2.5 text-[11px] font-semibold text-brand"
        >
          ＋ 選択肢を追加
        </button>
      )}
    </div>
  );
}

function OptionChoiceRow({
  itemId,
  groupId,
  choice,
  onChanged,
  onDelete,
}: {
  itemId: string;
  groupId: string;
  choice: PosMenuOptionChoice;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(choice.label);
  const [priceDelta, setPriceDelta] = useState(String(choice.price_delta));
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(priceDelta);
    if (!label.trim() || !Number.isFinite(value)) return;
    setSubmitting(true);
    try {
      await updateMenuOptionChoice(itemId, groupId, choice.id, { label: label.trim(), priceDelta: value });
      setEditing(false);
      onChanged();
    } catch {
      setLabel(choice.label);
      setPriceDelta(String(choice.price_delta));
    } finally {
      setSubmitting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="flex items-center gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-7 flex-1 rounded border border-border px-2 text-[12px]"
        />
        <input
          value={priceDelta}
          onChange={(e) => setPriceDelta(e.target.value)}
          inputMode="decimal"
          className="h-7 w-20 rounded border border-border px-2 text-[12px]"
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-7 rounded bg-primary px-2 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setLabel(choice.label);
            setPriceDelta(String(choice.price_delta));
          }}
          className="h-7 rounded border border-border px-2 text-[11px] font-semibold"
        >
          キャンセル
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-secondary/40">
      <button onClick={() => setEditing(true)} className="text-left text-[12.5px]">
        {choice.label} <span className="text-muted-foreground">({choice.price_delta >= 0 ? '+' : ''}${choice.price_delta.toFixed(2)})</span>
      </button>
      <button onClick={onDelete} className="text-[11px] font-semibold text-destructive">
        削除
      </button>
    </div>
  );
}

function AddOptionChoiceForm({
  itemId,
  groupId,
  onCreated,
  onCancel,
}: {
  itemId: string;
  groupId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [choiceKey, setChoiceKey] = useState('');
  const [label, setLabel] = useState('');
  const [priceDelta, setPriceDelta] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(priceDelta || '0');
    if (!choiceKey.trim() || !label.trim() || !Number.isFinite(value)) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMenuOptionChoice(itemId, groupId, { choiceKey: choiceKey.trim(), label: label.trim(), priceDelta: value });
      onCreated();
    } catch (err) {
      setError(err instanceof PosMenuApiError ? err.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-2.5">
      <div className="flex gap-2">
        <input
          value={choiceKey}
          onChange={(e) => setChoiceKey(e.target.value)}
          placeholder="キー (例: 100g)"
          className="h-7 w-24 rounded border border-border px-2 text-[12px]"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="表示名 (例: 100g)"
          className="h-7 flex-1 rounded border border-border px-2 text-[12px]"
        />
        <input
          value={priceDelta}
          onChange={(e) => setPriceDelta(e.target.value)}
          inputMode="decimal"
          placeholder="追加料金 ($)"
          className="h-7 w-24 rounded border border-border px-2 text-[12px]"
        />
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !choiceKey.trim() || !label.trim()}
          className="h-7 w-fit rounded bg-primary px-2.5 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {submitting ? '登録中…' : '登録する'}
        </button>
        <button type="button" onClick={onCancel} className="h-7 rounded border border-border px-2.5 text-[11.5px] font-semibold">
          キャンセル
        </button>
      </div>
    </form>
  );
}

// スタッフ管理・メニュー管理タブは POS ネイティブ (PIN ログイン) のセッションでのみ動作する。
// matsunoya-dine 連携ログイン (Telegram bot-login) の Cookie は別オリジンのため
// cambodia-pos のサーバー側からは見えず、API 側で認可できない (multi-tenant-productization-spec.md §3.4)。
function PinLoginRequiredNote() {
  const router = useRouter();
  return (
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
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function ToggleRow({
  name,
  desc,
  on,
  onToggle,
  disabled,
}: {
  name: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3.5">
      <div>
        <div className="text-[13.5px] font-semibold">{name}</div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{desc}</div>
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={
          'flex h-[26px] w-[46px] items-center rounded-full p-0.5 disabled:opacity-60 ' +
          (on ? 'justify-end bg-brand' : 'justify-start bg-secondary')
        }
      >
        <div className="h-[22px] w-[22px] rounded-full bg-card shadow" />
      </button>
    </div>
  );
}

function InfoNote({ title, body, cta, onCta }: { title: string; body: string; cta: string; onCta?: () => void }) {
  return (
    <div className="flex max-w-[560px] flex-col gap-3.5">
      <div className="text-[15px] font-bold">{title}</div>
      <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
        <div className="text-[13px] leading-relaxed">{body}</div>
        <button
          onClick={onCta}
          className="mt-1 h-[38px] w-fit rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground"
        >
          {cta}
        </button>
      </div>
    </div>
  );
}

// 連携設定タブ: pos.integrations.menu_source の ON/OFF 切り替え (Phase C)。
// owner のみ操作可能。行が無い店舗は 'dine_live' (matsunoya-dine 連携、現状維持) 扱い。
function IntegrationTab() {
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';

  const [mode, setMode] = useState<IntegrationMode | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    getIntegrationSettings()
      .then(({ menuSource }) => setMode(menuSource))
      .catch((err) => {
        setLoadError(err instanceof PosSettingsApiError ? err.message : '連携設定の取得に失敗しました');
      });
  }, []);

  useEffect(() => {
    if (isPosNative && me.role === 'owner') load();
  }, [isPosNative, me.role, load]);

  if (!isPosNative) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3.5">
        <div className="text-[15px] font-bold">連携設定</div>
        <PinLoginRequiredNote />
      </div>
    );
  }

  if (me.role !== 'owner') {
    return (
      <div className="flex max-w-[560px] flex-col gap-3.5">
        <div className="text-[15px] font-bold">連携設定</div>
        <div className="rounded-xl border border-border p-4 text-[13px] text-muted-foreground">
          連携設定の変更には owner 権限が必要です。
        </div>
      </div>
    );
  }

  async function handleSwitch(next: IntegrationMode) {
    if (mode === next) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const { menuSource } = await updateIntegrationSettings(next);
      setMode(menuSource);
    } catch (err) {
      setSwitchError(err instanceof PosSettingsApiError ? err.message : '切り替えに失敗しました');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <div>
        <div className="text-[15px] font-bold">連携設定</div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          レジ画面 (会計・注文) がどちらのメニュー・設定データを使うかを切り替えます。切り替えても過去の注文データや
          matsunoya-dine 側の予約・スタンプ機能には影響しません。
        </div>
      </div>

      {loadError && <div className="text-xs text-destructive">{loadError}</div>}
      {switchError && <div className="text-xs text-destructive">{switchError}</div>}

      {mode === null && !loadError && <div className="text-xs text-muted-foreground">読み込み中…</div>}

      {mode !== null && (
        <div className="flex flex-col gap-3">
          <IntegrationOption
            title="matsunoya-dine 連携 (現状維持)"
            desc="メニュー・VAT率・決済手段などは matsunoya-dine 管理画面で編集したものをそのまま使います。"
            selected={mode === 'dine_live'}
            disabled={switching}
            onSelect={() => handleSwitch('dine_live')}
          />
          <IntegrationOption
            title="POS単体運用"
            desc="この画面の「メニュー・商品オプション」「一般設定」「決済設定」タブで登録したデータを使います。matsunoya-dine とは独立して運用できます。"
            selected={mode === 'pos_native'}
            disabled={switching}
            onSelect={() => handleSwitch('pos_native')}
          />
        </div>
      )}
    </div>
  );
}

function IntegrationOption({
  title,
  desc,
  selected,
  disabled,
  onSelect,
}: {
  title: string;
  desc: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={
        'flex flex-col gap-1 rounded-xl border p-4 text-left disabled:opacity-60 ' +
        (selected ? 'border-brand bg-brand/5' : 'border-border')
      }
    >
      <div className="flex items-center gap-2 text-[13.5px] font-semibold">
        <span
          className={
            'inline-flex h-4 w-4 items-center justify-center rounded-full border ' +
            (selected ? 'border-brand bg-brand' : 'border-border')
          }
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-brand-foreground" />}
        </span>
        {title}
        {selected && <span className="text-[11px] font-semibold text-brand">使用中</span>}
      </div>
      <div className="pl-6 text-[11.5px] leading-relaxed text-muted-foreground">{desc}</div>
    </button>
  );
}
