import { LanguageProvider, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';
import { TicketMonitorScreen } from './ticket-monitor-screen';

// キッチンモニター画面 (2026-09-03 追加)。Tomからの要望「あとはどうやってレジプリンターと
// キッチンに情報を送るかを改めて考えましょう。(中略) キッチンはハンディーのようにキッチン
// モニターに設定すればキッチンモニターとして使えるようになれば簡単です」に対応。
//
// 紙の厨房伝票 (プリンター) の代わりに、確定・厨房送信された注文品目をこの画面に一覧表示し、
// 「調理完了」をタップすると一覧から消える (誤操作対策として、直近に完了した品目は「最近完了」
// セクションから「元に戻す」で復帰できる)。既存の厨房プリンター機能とは完全に独立しており、
// 印刷を併用している店舗にも影響しない。ハンディ (§0.1c) と同様、タブレット等を1台
// キッチンに据え置いて使うことを想定 (POS PIN ログイン後、画面を開いたままにする運用)。
//
// POS PIN ログイン・matsunoya-dine連携ログインのどちらでも使える (この画面が使う
// /api/pos-order/kitchen-tickets/* は他の /api/pos-order/* 系と同じく認証なしの公開API のため、
// §0.1h のような PosNativeOnlyNotice 制限は不要)。
//
// 2026-09-04: ドリンカーモニター追加にあたり、実体は ticket-monitor-screen.tsx に共通化した
// (kind='food' の薄いラッパーがこのファイル)。文字サイズ切替の記憶キーはキッチン用タブレットと
// ドリンク用タブレットで別々にするため namespace で分けている。

export function KitchenScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <TicketMonitorScreen kind="food" ns="kitchen" fontSizeStorageKey="posMonitorFontSize:kitchen" />
    </LanguageProvider>
  );
}
