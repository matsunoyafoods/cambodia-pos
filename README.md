# Cambodia POS

I'mHungry 454 (プノンペン) 店内会計・注文管理システム。matsunoya-dine と Supabase を共有する。

## 仕様書

- `docs/cambodia-pos-spec.md`（matsunoya-dine リポジトリ内）— 機能スコープ・ハードウェア・Phase 分け
- `docs/integration-spec.md`（matsunoya-dine リポジトリ内）— DB スキーマ (3.4章)・API 設計 (4章)
- 元 UI プロトタイプ: Cowork の design canvas アーティファクト（① 注文〜会計／② レジ締め／③ テーブルレイアウト／④ 設定）

## 現状 (このコミットの時点)

- Next.js 16 App Router + TypeScript + Tailwind の初期スキャフォールド
- 4画面 (`/pos`, `/pos/register-closing`, `/pos/table-layout`, `/pos/settings`) を実装（UIプロトタイプのロジックを React に移植したもの。表示データはまだ `src/lib/demo-data.ts` のデモデータ）
- `supabase/migrations/0001_pos_schema.sql` を本番 Supabase (`matsunoya-dine-prod`) に適用済み
- matsunoya-dine 側に `/api/pos/menus`, `/api/pos/settings`, `/api/pos/session` を実装済み（`src/lib/api-client.ts` から呼び出す）
- スタッフ認証を実装済み: `/pos/*` は `src/app/pos/layout.tsx` の `<StaffGate>` で保護され、未ログインなら `/login` に飛ぶ。ログインは matsunoya-dine 既存の Telegram bot-login をそのまま利用（同じブラウザなら Cookie がクロスオリジンで共有される）

## セットアップ

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` の項目:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — matsunoya-dine と同じ値
- `NEXT_PUBLIC_MATSUNOYA_DINE_API_URL` / `NEXT_PUBLIC_MATSUNOYA_DINE_ADMIN_LOGIN_URL` — 未設定なら本番 (`https://app.matsunoyafoods.com`) を指す。ローカル開発で matsunoya-dine もローカル起動している場合のみ上書き

ローカル build は避け、Vercel CI に任せる方針（matsunoya-dine と同じ、iCloud 同期問題のため）。

## 次にやること

1. [x] `supabase/migrations/0001_pos_schema.sql` を実際の Supabase プロジェクトに適用（`pos` スキーマ作成）— 2026-08-29 適用完了
2. [x] Vercel プロジェクト作成 → デプロイ
3. matsunoya-dine 側に POS 用 API エンドポイントを実装 (`integration-spec.md` 4.2) — `menus`/`settings`/`session` 実装済み。残り (customers/stamps/coupons/reservations/orders/table-layouts/expenses/register-closings/delivery-orders) は今後追加
4. スタッフ認証（Telegram bot-login 流用、`<StaffGate>`）— 実装済み。matsunoya-dine 側 Vercel に `POS_ALLOWED_ORIGINS=https://cambodia-pos.vercel.app` の設定が必須（未設定だと CORS でブロックされ /login が機能しない）
5. 各画面のデモデータ (`src/lib/demo-data.ts`) を実 API 呼び出しに差し替え（まず `/pos` のメニュー一覧・`/pos/settings` から）
