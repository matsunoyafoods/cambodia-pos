// テーブルレイアウト編集画面 (table-layout-screen.tsx) とレジ画面のテーブルマップ
// (table-map-screen.tsx) が同じ座標系で見取り図を描けるよう、キャンバスの固定サイズを
// 共有する。以前はレイアウト編集画面の見取り図が flex-1 (ブラウザ幅依存) だったため、
// 保存された x/y をそのままレジ画面で使うと位置がズレてしまっていた。
// POS アプリ自体が 1280×800 固定のキオスク画面として作られている (各画面 w-[1280px]
// h-[800px]) ことに合わせ、こちらも固定ピクセルサイズにする。
export const TABLE_LAYOUT_CANVAS_WIDTH = 940;
export const TABLE_LAYOUT_CANVAS_HEIGHT = 640;
