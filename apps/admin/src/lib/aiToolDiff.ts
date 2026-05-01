/**
 * AI 工具应用前差量预览的纯函数（与 React 解耦）。
 *
 * 抽出此模块的目的：`AiSidePanel`（编辑器右侧 AI 工具箱）与
 * `ToolResultRenderer`（独立 `/admin/ai-tools` 页）都需要计算
 * "AI 推荐 vs. 当前文章"的标签集合差量。两者视觉 chrome 不同
 * 但语义完全一致，逻辑必须共用避免漂移。
 */

export type TagDiff = {
  /** 文章已有 ∩ AI 选中（追加模式不变；替换模式作为"保留"项） */
  keep: string[];
  /** AI 选中但文章未有（两种模式都新增） */
  add: string[];
  /** 文章已有但 AI 未选中（仅替换模式才会真删；追加模式仅信息提示） */
  remove: string[];
  /** 应用后的最终标签列表（按 mode 组合） */
  finalList: string[];
};

/**
 * 计算 AI 推荐标签 vs. 当前文章标签的集合差量。
 *
 * 大小写不敏感比较（`["AI", "ai"]` 视为同一标签），但保留各自原始拼写
 * —— 用户可能想保留原本的大小写格式，AI 输出有时会规范化。
 */
export function computeTagDiff(
  current: string[],
  selected: string[],
  mode: 'replace' | 'append',
): TagDiff {
  const currentMap = new Map(current.map((t) => [t.toLowerCase(), t]));
  const selectedMap = new Map(selected.map((t) => [t.toLowerCase(), t]));

  const keep: string[] = [];
  const add: string[] = [];
  const remove: string[] = [];

  for (const [k, name] of selectedMap) {
    if (currentMap.has(k)) keep.push(currentMap.get(k)!);
    else add.push(name);
  }
  for (const [k, name] of currentMap) {
    if (!selectedMap.has(k)) remove.push(name);
  }

  const finalList =
    mode === 'replace' ? [...keep, ...add] : [...current, ...add];
  return { keep, add, remove, finalList };
}
