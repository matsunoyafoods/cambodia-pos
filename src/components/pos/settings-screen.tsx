'use client';

import { useState } from 'react';
import { DEFAULT_SETTINGS, type PosSettings } from '@/lib/pos-types';

type Tab = 'general' | 'printer' | 'payment' | 'staff' | 'menu' | 'layout';

const NAV: { key: Tab; label: string }[] = [
  { key: 'general', label: '一般設定' },
  { key: 'printer', label: 'プリンター設定' },
  { key: 'payment', label: '決済設定' },
  { key: 'staff', label: 'スタッフ管理' },
  { key: 'menu', label: 'メニュー・商品オプション' },
  { key: 'layout', label: 'テーブルレイアウト' },
];

const PRINTERS = [
  { name: 'レシートプリンター', desc: 'レジ横 ・ USB接続', ok: true },
  { name: 'キッチンプリンター', desc: '厨房 ・ LAN接続', ok: true },
];

const STAFF = [
  { name: 'Tom Matsuzaki', role: 'オーナー', initials: 'TM' },
  { name: 'Sok Dara', role: 'ホールスタッフ', initials: 'SD' },
  { name: 'Chan Vibol', role: 'キッチンスタッフ', initials: 'CV' },
];

// GET/PUT /api/pos/settings (integration-spec.md 4.2) に対応する画面。
// 保存は将来ここで supabase.from('settings').upsert(...) を叩く。
export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  function update<K extends keyof PosSettings>(key: K, value: PosSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  return (
    <div className="flex h-[800px] w-[1280px] flex-col overflow-hidden bg-background">
      <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border px-6">
        <div>
          <div className="text-base font-bold">設定</div>
          <div className="text-xs text-muted-foreground">店舗の各種設定を管理します</div>
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
              <Field label="VAT率 (%)">
                <input
                  value={settings.vatRate}
                  onChange={(e) => update('vatRate', parseFloat(e.target.value) || 0)}
                  className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px]"
                />
              </Field>
              <Field label="サービス料率 (%)">
                <input
                  value={settings.serviceRate}
                  onChange={(e) => update('serviceRate', parseFloat(e.target.value) || 0)}
                  className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px]"
                />
              </Field>
              <Field label="参考為替レート (1 USD = ? KHR)">
                <input
                  value={settings.khrRate}
                  onChange={(e) => update('khrRate', parseInt(e.target.value, 10) || 0)}
                  className="h-10 w-40 rounded-lg border border-border px-3 text-[13.5px]"
                />
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  レジ締め・会計画面のKHR自動計算に使用されます。日次で更新してください。
                </div>
              </Field>
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
              <ToggleRow
                name="現金"
                desc="USD / KHR 混在対応"
                on={settings.cashEnabled}
                onToggle={() => update('cashEnabled', !settings.cashEnabled)}
              />
              <ToggleRow
                name="QR (ABA/KHQR)"
                desc="静的QR表示・手動確認"
                on={settings.qrEnabled}
                onToggle={() => update('qrEnabled', !settings.qrEnabled)}
              />
              <ToggleRow
                name="カード"
                desc="外部端末決済・手動記録"
                on={settings.cardEnabled}
                onToggle={() => update('cardEnabled', !settings.cardEnabled)}
              />
            </div>
          )}

          {tab === 'staff' && (
            <div className="flex max-w-[640px] flex-col gap-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-[15px] font-bold">スタッフ管理</div>
                <button className="h-9 rounded-lg border border-dashed border-brand px-3.5 text-[12.5px] font-semibold text-brand">
                  ＋ スタッフを追加
                </button>
              </div>
              {STAFF.map((s) => (
                <div key={s.name} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                      {s.initials}
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold">{s.name}</div>
                      <div className="text-[11.5px] text-muted-foreground">{s.role}</div>
                    </div>
                  </div>
                  <button className="h-8 rounded-lg border border-border px-3 text-xs font-semibold">
                    PINをリセット
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'menu' && (
            <InfoNote
              title="メニュー・商品オプション"
              body="メニュー内容・価格・グラム数などの商品オプション（例: ステーキの量目、セットの主食選択）は matsunoya-dine 管理画面が唯一の編集元です。POS側では表示のみとなります。"
              cta="matsunoya-dine 管理画面を開く"
            />
          )}

          {tab === 'layout' && (
            <InfoNote
              title="テーブルレイアウト"
              body="卓の配置・卓番号・席数は専用のレイアウト編集画面から変更できます。ドラッグ＆ドロップで自由に配置を調整できます。"
              cta="レイアウト編集を開く"
            />
          )}
        </div>
      </div>
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

function ToggleRow({ name, desc, on, onToggle }: { name: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3.5">
      <div>
        <div className="text-[13.5px] font-semibold">{name}</div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{desc}</div>
      </div>
      <button
        onClick={onToggle}
        className={'flex h-[26px] w-[46px] items-center rounded-full p-0.5 ' + (on ? 'justify-end bg-brand' : 'justify-start bg-secondary')}
      >
        <div className="h-[22px] w-[22px] rounded-full bg-card shadow" />
      </button>
    </div>
  );
}

function InfoNote({ title, body, cta }: { title: string; body: string; cta: string }) {
  return (
    <div className="flex max-w-[560px] flex-col gap-3.5">
      <div className="text-[15px] font-bold">{title}</div>
      <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
        <div className="text-[13px] leading-relaxed">{body}</div>
        <button className="mt-1 h-[38px] w-fit rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground">
          {cta}
        </button>
      </div>
    </div>
  );
}
