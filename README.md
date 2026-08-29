# Cambodia POS

I'mHungry 454 (プノンペン) 店内会計・注文管理システム。matsunoya-dine と Supabase を共有する。

## 仕様書

- `docs/cambodia-pos-spec.md`（matsunoya-dine リポジトリ内）— 機能スコープ・ハードウェア・Phase 分け
- `docs/integration-spec.md`（matsunoya-dine リポジトリ内）— DB スキーマ (3.4章)・API 設計 (4章)
- 元 UI プロトタイプ: Cowork の design canvas アーティファクト（① 注文〜会計／② レジ締め／③ テーブルレイアウト／④ 設定）

## 現状 (このコミットの時点)

- Next.js 16 App Router + TypeScript + Tailwind の初期スキャフォールド
- 4画面 (`/pos`, `/pos/register-closing`, `/pos/table-layout`, `/pos/settings`) を **ローカル state のみ** で実装（UIプロトタイプのロジックを React に移植したもの）
- `supabase/migrations/0001_pos_schema.sql` に `pos` スキーマ + `menu_option_groups/choices` の DDL 草案
- Supabase / matsunoya-dine API への接続は **未実装**（`src/lib/supabase/*` にクライアントの雛形のみ）

## セットアップ

```bash
npm install
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL / ANON_KEY を matsunoya-dine と同じ値で設定
npm run dev
```

ローカル build は避け、Vercel CI に任せる方針（matsunoya-dine と同じ、iCloud 同期問題のため）。

## 次にやること

1. [x] `supabase/migrations/0001_pos_schema.sql` を実際の Supabase プロジェクトに適用（`pos` スキーマ作成）— 2026-08-29 適用完了
2. [x] Vercel プロジェクト作成 → デプロイ
3. matsunoya-dine 側に POS 用 API エンドポイントを実装 (`integration-spec.md` 4.2)
4. 各画面のデモデータ (`src/lib/demo-data.ts`) を実 API 呼び出しに差し替え
5. スタッフ認証（`public.users` + `public.store_members.role` を利用、matsunoya-dine の既存ログインを流用）を実装
