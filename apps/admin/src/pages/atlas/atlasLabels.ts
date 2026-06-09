// Atlas 术语 → 用户语言的统一映射。
//
// ref: docs/pm/atlas-redesign.md §4 P0-5 去术语化
// 数据模型里仍用 claim/concept/seed/ai_suggested 等英文枚举（与后端/类型对齐），
// 但任何呈现给用户的地方都过这层翻译，避免裸露 schema 黑话。

export function kpTypeLabel(type: string): string {
  const map: Record<string, string> = {
    claim: '主张',
    concept: '概念',
    question: '问题',
    definition: '定义',
    method: '方法',
    example: '示例',
    person: '人物',
    source: '来源',
  };
  return map[type] ?? type;
}

export function kpStatusLabel(status: string): string {
  const map: Record<string, string> = {
    seed: '萌芽',
    growing: '成长',
    evergreen: '常青',
    archived: '归档',
  };
  return map[status] ?? status;
}

export function provenanceLabel(provenance: string): string {
  const map: Record<string, string> = {
    user: '手动',
    ai_suggested: 'AI',
    imported: '导入',
  };
  return map[provenance] ?? provenance;
}

export function relationTypeLabel(type: string): string {
  const map: Record<string, string> = {
    supports: '支持',
    refutes: '反驳',
    causes: '导致',
    part_of: '从属',
    similar_to: '相似',
    derived_from: '衍生',
    contrasts_with: '对比',
    depends_on: '依赖',
    cites: '引用',
  };
  return map[type] ?? type;
}

export function suggestionKindLabel(kind: string): string {
  if (kind === 'kp') return '知识点';
  if (kind === 'relation') return '关系';
  return kind;
}

export function suggestionStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '待处理',
    accepted: '已采纳',
    rejected: '已拒绝',
    ignored: '已忽略',
    expired: '已过期',
  };
  return map[status] ?? status;
}

export function anchorStateLabel(state: string): string {
  const map: Record<string, string> = {
    anchored: '已锚定',
    soft_anchored: '弱锚定',
    orphan: '已失锚',
  };
  return map[state] ?? state;
}
