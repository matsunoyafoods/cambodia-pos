import { LanguageProvider, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';
import { TicketMonitorScreen } from './ticket-monitor-screen';

// ドリンカーモニター画面 (2026-09-04 追加。Tomからの要望「キッチンモニターに加えてドリンカー
// モニターも追加」に対応)。キッチンモニターと全く同じ仕組み (ticket-monitor-screen.tsx 共通実装)
// で、表示対象を kind='drink' のカテゴリーに属する商品だけに絞ったもの。ドリンクカテゴリーの
// 判定は 設定 > メニュー タブでカテゴリーごとに「フード/ドリンク」を切り替えて行う
// (pos.menu_categories.kind)。バーカウンター等にタブレットを1台据え置いて使うことを想定。

export function DrinkMonitorScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <TicketMonitorScreen kind="drink" ns="drink" fontSizeStorageKey="posMonitorFontSize:drink" />
    </LanguageProvider>
  );
}
