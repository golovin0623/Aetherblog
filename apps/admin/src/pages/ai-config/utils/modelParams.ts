// 模型参数控件目录 —— 模型中心「扩展参数 / 采样参数」的可读化与分组
// ref: §5.1 - AI Service 架构 · 模型参数控制
//
// 背景：模型声明它「支持哪些可调参数」(extendParams)，真正取值由会话/智能体侧设定。
// 历史实现把 extendParams 渲染成一排裸 camelCase 按钮（如 `gpt5_2ProReasoningEffort`），
// 既不可读也无分组。这里提供一份「分组 + 中文标签 + 说明 + 能力推荐」的目录，
// 让管理端用可读的方式勾选，同时保留对任意自定义参数 id 的兼容（不丢未知项）。

import type { ModelAbility, SamplingParam } from '../types';

export type ParamGroupKey = 'reasoning' | 'thinking' | 'context' | 'multimodal' | 'custom';

export interface ParamGroupMeta {
  key: ParamGroupKey;
  label: string;
  hint: string;
}

export interface ParamControl {
  id: string;
  label: string;
  desc: string;
  group: ParamGroupKey;
}

// 分组元数据（渲染顺序即声明顺序）
export const PARAM_GROUPS: ParamGroupMeta[] = [
  { key: 'reasoning', label: '推理控制', hint: '推理强度与开关' },
  { key: 'thinking', label: '思考预算', hint: '思维链 token 预算与档位' },
  { key: 'context', label: '上下文与检索', hint: '缓存与联网增强' },
  { key: 'multimodal', label: '多模态与输出', hint: '图像/视频与冗长度' },
  { key: 'custom', label: '自定义参数', hint: '目录外的扩展参数' },
];

// 精选的通用参数控件（中性命名，覆盖主流可调维度；模型专属变体仍可作为自定义项保留）
export const PARAM_CONTROLS: ParamControl[] = [
  // —— 推理控制 ——
  { id: 'enableReasoning', label: '启用推理', desc: '开启模型的链式推理 / 思考过程', group: 'reasoning' },
  { id: 'reasoningEffort', label: '推理强度', desc: 'low / medium / high 三档算力投入', group: 'reasoning' },
  { id: 'effort', label: '努力档位', desc: '通用努力级别（含 max）', group: 'reasoning' },
  // —— 思考预算 ——
  { id: 'thinking', label: '思考模式', desc: 'disabled / auto / enabled 切换', group: 'thinking' },
  { id: 'thinkingBudget', label: '思考预算', desc: '思维链可用的 token 预算上限', group: 'thinking' },
  { id: 'reasoningBudgetToken', label: '推理 token 预算', desc: '为推理阶段单独分配的 token 预算', group: 'thinking' },
  { id: 'thinkingLevel', label: '思考档位', desc: '离散的思考深度档位', group: 'thinking' },
  // —— 上下文与检索 ——
  { id: 'disableContextCaching', label: '关闭上下文缓存', desc: '禁用提示词 KV 缓存（强一致场景）', group: 'context' },
  { id: 'urlContext', label: 'URL 上下文', desc: '允许模型抓取并理解链接内容', group: 'context' },
  // —— 多模态与输出 ——
  { id: 'textVerbosity', label: '输出冗长度', desc: 'low / medium / high 控制回答详略', group: 'multimodal' },
  { id: 'imageAspectRatio', label: '图像比例', desc: '出图画幅比例（1:1 / 16:9 等）', group: 'multimodal' },
  { id: 'imageResolution', label: '图像分辨率', desc: '出图分辨率（1K / 2K / 4K）', group: 'multimodal' },
];

const CONTROL_BY_ID = new Map<string, ParamControl>(PARAM_CONTROLS.map((c) => [c.id, c]));

// 标准采样参数（用于 disabledParams：勾选即「调用时省略该参数」）
export interface SamplingParamMeta {
  id: SamplingParam;
  label: string;
  desc: string;
}

export const SAMPLING_PARAMS: SamplingParamMeta[] = [
  { id: 'temperature', label: '温度 temperature', desc: '采样随机性，0 最确定、2 最发散' },
  { id: 'top_p', label: '核采样 top_p', desc: '累积概率截断，建议与温度二选一' },
  { id: 'frequency_penalty', label: '频率惩罚', desc: '降低重复用词的概率' },
  { id: 'presence_penalty', label: '话题惩罚', desc: '鼓励模型引入新话题' },
];

// 能力 → 推荐参数。勾选某能力后，这些参数会被标记「推荐」以引导配置。
const ABILITY_RECOMMENDED: Partial<Record<keyof ModelAbility, string[]>> = {
  reasoning: ['enableReasoning', 'reasoningEffort', 'thinkingBudget'],
  imageOutput: ['imageAspectRatio', 'imageResolution'],
  search: ['urlContext'],
};

export interface GroupedParamControl extends ParamControl {
  selected: boolean;
  recommended: boolean;
}

export interface GroupedParamSection {
  group: ParamGroupMeta;
  controls: GroupedParamControl[];
}

/**
 * 依据当前已选扩展参数与模型能力，产出「分组后的控件列表」。
 * - 目录内控件按分组归位；
 * - 已选但不在目录中的自定义 id 归入 `custom` 分组，保证编辑回写不丢失；
 * - 命中能力推荐的控件标记 `recommended`。
 */
export function groupParamControls(
  selected: Iterable<string>,
  abilities?: ModelAbility | null
): GroupedParamSection[] {
  const selectedSet = new Set(selected);
  const recommended = recommendedParamIds(abilities);

  // 目录控件按分组聚合
  const byGroup = new Map<ParamGroupKey, GroupedParamControl[]>();
  for (const meta of PARAM_GROUPS) byGroup.set(meta.key, []);

  for (const control of PARAM_CONTROLS) {
    byGroup.get(control.group)!.push({
      ...control,
      selected: selectedSet.has(control.id),
      recommended: recommended.has(control.id),
    });
  }

  // 未知的已选项 → custom 分组
  for (const id of selectedSet) {
    if (!CONTROL_BY_ID.has(id)) {
      byGroup.get('custom')!.push({
        id,
        label: id,
        desc: '自定义扩展参数',
        group: 'custom',
        selected: true,
        recommended: false,
      });
    }
  }

  return PARAM_GROUPS.map((group) => ({ group, controls: byGroup.get(group.key)! })).filter(
    (section) => section.controls.length > 0
  );
}

/** 根据模型能力返回推荐勾选的参数 id 集合。 */
export function recommendedParamIds(abilities?: ModelAbility | null): Set<string> {
  const ids = new Set<string>();
  if (!abilities) return ids;
  (Object.keys(ABILITY_RECOMMENDED) as Array<keyof ModelAbility>).forEach((ability) => {
    if (abilities[ability]) {
      ABILITY_RECOMMENDED[ability]!.forEach((id) => ids.add(id));
    }
  });
  return ids;
}

/** 目录查找（未知 id 返回 undefined）。 */
export function getParamControl(id: string): ParamControl | undefined {
  return CONTROL_BY_ID.get(id);
}
