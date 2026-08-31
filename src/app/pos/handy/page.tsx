import { HandyApp } from '@/components/pos/handy-app';

// ハンディ (タブレット・スマホ) 向け注文入力の専用ページ (2026-08-31 追加)。
// レジ画面 (/pos) はキオスク端末向けの固定 1280×800px レイアウトのためこのページとは
// 共有せず、HandyApp はフル画面・レスポンシブに描画する。
export default function PosHandyPage() {
  return <HandyApp />;
}
