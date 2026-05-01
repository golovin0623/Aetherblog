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

// ───────────────────────── 新版 4-bucket 计划 ─────────────────────────
//
// `computeTagDiff` 把"AI 选中但文章未有"统一称作 add —— 在旧 UX 里这就够了
// (反正都创建)。新 UX 区分两种来源:
//   - linkExisting: 选中的项是现有标签 (有 tagId), 应用时直接关联,不创建
//   - createNew:    选中的项是 AI 新建议 (无 tagId), 应用时会先创建再关联
// 视觉上希望分别给出徽标 ("已存在 N 篇" / "新建") 与不同色调,差异化让用户
// 在点"应用"前对副作用有清晰认知。

/** 选中标签的元数据。`tagId` 标识"这是已存在的标签",未提供则视为待新建。 */
export type SelectedTagItem = {
  name: string;
  tagId?: number;
  /** 仅用于显示;不影响应用动作。 */
  postCount?: number;
};

/** 当前文章上挂的标签 (id + name 都需要,用于精准比对 + 反向查找)。 */
export type CurrentTagRef = { id: number; name: string };

export type TagPlan = {
  /** 已在文章上 + 仍被选中: 应用后保留 (两种模式都不动)。 */
  keep: CurrentTagRef[];
  /** 选中的 + 现有标签 (tagId 已知) + 不在文章上: 应用后关联,不创建。 */
  linkExisting: SelectedTagItem[];
  /** 选中的 + AI 新建议 (无 tagId): 应用后会先创建再关联。 */
  createNew: SelectedTagItem[];
  /** 文章已有 + 未被选中: 仅 replace 模式真删,append 模式仅信息提示。 */
  remove: CurrentTagRef[];
  /** 应用后的最终标签名列表 (按 mode 组合, 已去重)。 */
  finalNames: string[];
};

/**
 * 把 (当前文章标签 + 选中项 + 模式) 折算成 4-bucket 的应用计划。
 *
 * 比较以"标签名 lower-case"为 key —— 与后端 `tag_repo.FindByName` 的语义一致
 * (Postgres 列默认大小写敏感, 但业务层把名字当人类可读标识, 大小写无关)。
 * `tagId` 的存在性决定 add 类项目走 linkExisting 还是 createNew, 与名字大小写
 * 比对解耦。
 */
export function computeTagPlan(
  current: CurrentTagRef[],
  selected: SelectedTagItem[],
  mode: 'replace' | 'append',
): TagPlan {
  const currentByKey = new Map(current.map((t) => [t.name.toLowerCase(), t]));
  const selectedByKey = new Map<string, SelectedTagItem>();
  for (const item of selected) {
    const key = (item.name || '').trim().toLowerCase();
    if (!key) continue;
    if (selectedByKey.has(key)) continue;
    selectedByKey.set(key, item);
  }

  const keep: CurrentTagRef[] = [];
  const linkExisting: SelectedTagItem[] = [];
  const createNew: SelectedTagItem[] = [];
  const remove: CurrentTagRef[] = [];

  for (const [key, item] of selectedByKey) {
    const onPost = currentByKey.get(key);
    if (onPost) {
      keep.push(onPost);
      continue;
    }
    if (item.tagId !== undefined) {
      linkExisting.push(item);
    } else {
      createNew.push(item);
    }
  }

  for (const [key, ref] of currentByKey) {
    if (!selectedByKey.has(key)) remove.push(ref);
  }

  let finalNames: string[];
  if (mode === 'replace') {
    finalNames = [
      ...keep.map((t) => t.name),
      ...linkExisting.map((t) => t.name),
      ...createNew.map((t) => t.name),
    ];
  } else {
    // append: 当前所有标签 + 新加入的两类
    finalNames = [
      ...current.map((t) => t.name),
      ...linkExisting.map((t) => t.name),
      ...createNew.map((t) => t.name),
    ];
  }

  return { keep, linkExisting, createNew, remove, finalNames };
}
