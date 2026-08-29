# Cambodia POS

I'mHungry 454 (プノンペン) 店内会計・注文管理システム。matsunoya-dine と Supabase を共有する。

## 仕様書

- `docs/cambodia-pos-spec.md`（matsunoya-dine リポジトリ内）— 機能スコープ・ハードウェア・Phase 分け
- `docs/integration-spec.md`（matsunoya-dine リポジトリ内）— DB スキーマ (3.4章)・API 設計 (4章)
- 元 UI プロトタイプ: Cowork の design canvas アーティファクト（① 注文〜会計／② レジ締め／③ テーブルレイアウト／④ 設定）

## 現状 (このコミットの時点)

- Next.js 16 App Router + TypeScript + Tailwind の初期スキャフォールド
- 4画面 (`/pos`, `/pos/register-closing`, `/pos/table-layout`, `/pos/settings`) を実装（UIプロトタイプのロジックを React に移植したもの）
- `supabase/migrations/0001_pos_schema.sql` を本番 Supabase (`matsunoya-dine-prod`) に適用済み
- matsunoya-dine 側に `/api/pos/menus`, `/api/pos/settings`, `/api/pos/session` を実装済み（`src/lib/api-client.ts` から呼び出す）
- スタッフ認証を実装済み・本番で動作確認済み: `/pos/*` は `src/app/pos/layout.tsx` の `<StaffGate>` で保護され、未ログインなら `/login` に飛ぶ。ログインは matsunoya-dine 既存の Telegram bot-login をそのまま利用（同じブラウザなら Cookie がクロスオリジンで共有される）。`POS_ALLOWED_ORIGINS` 設定 + Redeploy 済み、実機ログイン成功を確認 (2026-08-29)
- `/pos` (注文画面) は `getPosMenus()`/`getPosSettings()` で実データ取得済み（メニュー一覧・VAT/サービス料率・カテゴリ一覧）。取得中は読み込み中表示、失敗時はエラー表示 + 再読み込みボタン
- `/pos/table-layout` のテーブル一覧・卓状況はまだ `src/lib/demo-data.ts` のデモデータ（`/api/pos/table-layouts` 系 API 未実装のため）
- `/pos/settings` 画面もまだローカル state のみ（保存しても matsunoya-dine 側に反映されない）

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
4. [x] スタッフ認証（Telegram bot-login 流用、`<StaffGate>`）— 実装済み。`POS_ALLOWED_ORIGINS=https://cambodia-pos.vercel.app` 設定・Redeploy 済み、実機ログイン確認済み (2026-08-29)
5. [x] `/pos` のメニュー一覧・VAT/サービス料率を実 API (`getPosMenus`/`getPosSettings`) に差し替え済み (2026-08-29)
6. 発注確定 (`POST /api/pos/orders`) を実装し、`completeOrder()` から実際に注文をサーバーへ送信するように差し替える（現状はローカル state 遷移のみで保存されない）
7. `/pos/table-layout` 用の卓管理 API (`table-layouts`) を実装し、テーブル一覧・使用中/会計待ちステータスをデモデータから差し替える
8. `/pos/settings` 画面を `getPosSettings`/`updatePosSettings` に接続（保存ボタンを実際の PUT に接続。manager 以上のみ保存可）
