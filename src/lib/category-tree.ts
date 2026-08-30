/**
 * 3階層カテゴリ (大→中→小) の共通ロジック。
 * pos.menu_categories は自己参照の parent_id を持つフラットなテーブル
 * (深さ0=大カテゴリー, 深さ1=中 または 中無しの小, 深さ2=小) なので、
 * サーバー (メニューAPI) ・クライアント (設定画面) の両方からこのユーティリティで
 * 「大カテゴリー名・中カテゴリー名(あれば)・小カテゴリー名」を解決する。
 *
 * 深さの意味:
 * - depth 0 (parent_id が null): 大カテゴリー
 * - depth 1 (parent が大カテゴリー): 「中カテゴリー」として使われることも、
 *   中カテゴリーを作らず商品を直接ぶら下げる「小カテゴリー」として使われることもある
 *   (商品側から見てどちらかは区別しない。表示解決時にどちらの役割かを判定する)
 * - depth 2 (parent が depth1): 常に「小カテゴリー」(中カテゴリーの下)
 */

export type CategoryNode = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

export type ResolvedCategory = {
  majorId: string;
  majorName: string;
  middleId: string | null;
  middleName: string | null;
  minorId: string;
  minorName: string;
};

/** id引き用マップを作る */
export function indexCategories(categories: CategoryNode[]): Map<string, CategoryNode> {
  return new Map(categories.map((c) => [c.id, c]));
}

/**
 * 商品が直接紐づくカテゴリ (leaf, どの深さでもありうる) から、
 * 大カテゴリー・中カテゴリー(あれば)・小カテゴリーを解決する。
 */
export function resolveCategoryChain(
  leafId: string | null,
  byId: Map<string, CategoryNode>,
): ResolvedCategory | null {
  if (!leafId) return null;
  const leaf = byId.get(leafId);
  if (!leaf) return null;

  const parent = leaf.parent_id ? byId.get(leaf.parent_id) : undefined;
  if (!parent) {
    // depth0: 大カテゴリーに商品が直接ぶら下がっている (旧フラット構成、または未整理)
    return { majorId: leaf.id, majorName: leaf.name, middleId: null, middleName: null, minorId: leaf.id, minorName: leaf.name };
  }

  const grandparent = parent.parent_id ? byId.get(parent.parent_id) : undefined;
  if (!grandparent) {
    // depth1: 中カテゴリーを介さず、大カテゴリー直下の小カテゴリー
    return { majorId: parent.id, majorName: parent.name, middleId: null, middleName: null, minorId: leaf.id, minorName: leaf.name };
  }

  // depth2: 大 > 中 > 小
  return {
    majorId: grandparent.id,
    majorName: grandparent.name,
    middleId: parent.id,
    middleName: parent.name,
    minorId: leaf.id,
    minorName: leaf.name,
  };
}

/** そのカテゴリの深さ (0=大, 1=中/小, 2=小)。存在しない/不正な親チェーンは null */
export function categoryDepth(id: string, byId: Map<string, CategoryNode>): number | null {
  const node = byId.get(id);
  if (!node) return null;
  if (!node.parent_id) return 0;
  const parent = byId.get(node.parent_id);
  if (!parent) return null;
  if (!parent.parent_id) return 1;
  return 2;
}

/** 表示用のグループ見出し (中カテゴリー名があればそれ、無ければ小カテゴリー名。両方大カテゴリーと同じ=旧フラット構成ならnull=見出し無し) */
export function groupLabelFor(resolved: ResolvedCategory): string | null {
  if (resolved.middleName) return resolved.middleName;
  if (resolved.minorName !== resolved.majorName) return resolved.minorName;
  return null;
}
