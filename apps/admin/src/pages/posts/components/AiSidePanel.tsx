import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  FileText,
  Hash,
  Heading,
  ListTree,
  Languages,
  RefreshCw,
  X,
  Copy,
  Check,
  Replace,
  PlusCircle,
  Minus,
  ArrowRight,
} from 'lucide-react';
import { aiService } from '@/services/aiService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ModelSelector } from '@/components/ai/ModelSelector';
import { useEditorStore } from '@/stores/editorStore';

export type AiPanelAction = 'summary' | 'tags' | 'titles' | 'polish' | 'outline' | 'translate';

export interface AiSidePanelHandle {
  runAction: (action: AiPanelAction) => void;
}

interface AiSidePanelProps {
  isMobile?: boolean;
  content: string;
  title: string;
  summary: string;
  /** 文章当前已选标签名（用于"应用前 / 应用后"差量预览）。大小写敏感保留首次出现拼写。 */
  currentTagNames: string[];
  selectedModelId?: string;
  selectedProviderCode?: string;
  onModelChange: (modelId: string, providerCode: string) => void;
  onClose: () => void;
  onInsertText: (text: string) => void;
  onReplaceContent: (text: string) => void;
  onUpdateSummary: (summary: string) => void;
  onUpdateTitle: (title: string) => void;
  onApplyTags: (tags: string[], mode: 'replace' | 'append') => Promise<void>;
}

/** 单行差量：保留 / 新增 / 移除 三色 chip */
function TagDiffRow({
  label,
  tags,
  tone,
  icon,
}: {
  label: string;
  tags: string[];
  tone: 'neutral' | 'add' | 'remove';
  icon: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)]">
        {icon}
        {label}（{tags.length}）
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className={cn(
              'inline-flex items-center px-2 py-0.5 text-[11px] rounded-full border',
              tone === 'add' && 'bg-[color-mix(in_oklch,var(--signal-success)_14%,transparent)] text-[var(--signal-success)] border-[color-mix(in_oklch,var(--signal-success)_28%,transparent)]',
              tone === 'remove' && 'bg-[color-mix(in_oklch,var(--signal-danger)_12%,transparent)] text-[var(--signal-danger)] border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] line-through opacity-80',
              tone === 'neutral' && 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
            )}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 标签集合差量：把 AI 推荐的"已选"集合和文章当前标签合并，分出
 *   keep      —— 文章已有 ∩ 选中（追加模式不变；替换模式作为"保留"项）
 *   add       —— 选中但文章没有（两种模式都新增）
 *   remove    —— 文章已有但未选中（仅替换模式才会真的移除；追加模式仅作为"未涉及"提示）
 *   finalList —— 应用后的最终标签列表（按 mode 计算）
 *
 * 大小写不敏感比较，但保留各自原始拼写。
 */
function computeTagDiff(
  current: string[],
  selected: string[],
  mode: 'replace' | 'append',
): { keep: string[]; add: string[]; remove: string[]; finalList: string[] } {
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

  let finalList: string[];
  if (mode === 'replace') {
    finalList = [...keep, ...add];
  } else {
    // append: 不动既有，仅在末尾追加新增项
    finalList = [...current, ...add];
  }
  return { keep, add, remove, finalList };
}

type AiPanelResult =
  | { type: 'text'; action: AiPanelAction; text: string }
  | { type: 'tags'; tags: string[] }
  | { type: 'titles'; titles: string[] };

const toolConfig: Array<{
  key: AiPanelAction;
  label: string;
  icon: ComponentType<{ className?: string }>;
  desc: string;
}> = [
    { key: 'summary', label: '生成摘要', icon: FileText, desc: '提炼文章要点' },
    { key: 'tags', label: '智能标签', icon: Hash, desc: '推荐相关标签' },
    { key: 'titles', label: '标题建议', icon: Heading, desc: '生成多个标题' },
    { key: 'polish', label: '全文润色', icon: Sparkles, desc: '优化表达与结构' },
    { key: 'outline', label: '生成大纲', icon: ListTree, desc: '快速生成结构' },
    { key: 'translate', label: '全文翻译', icon: Languages, desc: '翻译为指定语言' },
  ];

const languageOptions = [
  { value: 'en', label: '英语' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
];

export const AiSidePanel = forwardRef<AiSidePanelHandle, AiSidePanelProps>(
  ({
    isMobile = false,
    content,
    title,
    summary,
    currentTagNames,
    selectedModelId,
    selectedProviderCode,
    onModelChange,
    onClose,
    onInsertText,
    onReplaceContent,
    onUpdateSummary,
    onUpdateTitle,
    onApplyTags,
  }, ref) => {
    const [loadingAction, setLoadingAction] = useState<AiPanelAction | null>(null);
    const [result, setResult] = useState<AiPanelResult | null>(null);
    const [activeAction, setActiveAction] = useState<AiPanelAction>('summary');
    const [targetLanguage, setTargetLanguage] = useState('en');
    const [copied, setCopied] = useState(false);
    /** 当前 tag 工具结果中被勾选的标签名（小写键） */
    const [selectedTagKeys, setSelectedTagKeys] = useState<Set<string>>(new Set());
    /** 用户拟定的应用模式 —— 决定差量预览展示的最终列表形态 */
    const [tagApplyMode, setTagApplyMode] = useState<'replace' | 'append'>('append');

    const enableSelectionAi = useEditorStore((state) => state.enableSelectionAi);
    const setEnableSelectionAi = useEditorStore((state) => state.setEnableSelectionAi);
    const enableSlashAi = useEditorStore((state) => state.enableSlashAi);
    const setEnableSlashAi = useEditorStore((state) => state.setEnableSlashAi);

    const canRun = useMemo(() => content.trim().length > 0, [content]);

    const runAction = useCallback(async (action: AiPanelAction, options?: { regenerate?: boolean }) => {
      if (!canRun) {
        toast.error('请先输入文章内容');
        return;
      }

      const bypassCache = options?.regenerate === true;

      setActiveAction(action);
      setLoadingAction(action);
      setResult(null);
      setCopied(false);

      const modelPayload =
        selectedModelId && selectedProviderCode
          ? { modelId: selectedModelId, providerCode: selectedProviderCode }
          : {};

      try {
        if (action === 'summary') {
          // 显式传 maxLength: 不传时 ai-service DTO 默认 200, 但前端不传会让
          // {max_length} 占位符在 prompt 中失去能见度。这里固定 200 字与
          // ai_task_types 的种子默认对齐, 后续可在 UI 加输入控件让用户调。
          const res = await aiService.generateSummary({ content, maxLength: 200, bypassCache, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'text', action, text: res.data.summary });
          } else {
            toast.error(res.message || '摘要生成失败');
          }
        }

        if (action === 'tags') {
          const res = await aiService.extractTags({ content, maxTags: 6, bypassCache, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'tags', tags: res.data.tags });
          } else {
            toast.error(res.message || '标签提取失败');
          }
        }

        if (action === 'titles') {
          const res = await aiService.suggestTitles({ content, maxTitles: 6, bypassCache, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'titles', titles: res.data.titles });
          } else {
            toast.error(res.message || '标题生成失败');
          }
        }

        if (action === 'polish') {
          const res = await aiService.polishContent({ content, tone: '专业', bypassCache, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'text', action, text: res.data.polishedContent });
          } else {
            toast.error(res.message || '润色失败');
          }
        }

        if (action === 'outline') {
          const topic = title.trim() || content.trim().slice(0, 100);
          const res = await aiService.generateOutline({ topic, existingContent: content, depth: 2, style: 'professional', bypassCache, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'text', action, text: res.data.outline });
          } else {
            toast.error(res.message || '大纲生成失败');
          }
        }

        if (action === 'translate') {
          const res = await aiService.translateContent({ content, targetLanguage, bypassCache, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'text', action, text: res.data.translatedContent });
          } else {
            toast.error(res.message || '翻译失败');
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 处理失败';
        toast.error(message);
      } finally {
        setLoadingAction(null);
      }
    }, [canRun, content, title, targetLanguage, selectedModelId, selectedProviderCode]);

    useImperativeHandle(ref, () => ({ runAction: (action: AiPanelAction) => runAction(action) }));

    // tags 结果变化时（重新生成 / 切换工具）默认全选所有推荐标签 —— 与
    // ToolResultRenderer.TagsResult 行为一致, 保持两个触点心智模型相同。
    useEffect(() => {
      if (result?.type === 'tags') {
        setSelectedTagKeys(new Set(result.tags.map((t) => t.toLowerCase())));
      } else {
        setSelectedTagKeys(new Set());
      }
    }, [result]);

    const regenerateCurrent = useCallback(() => {
      if (!result) return;
      const action: AiPanelAction =
        result.type === 'tags' ? 'tags'
        : result.type === 'titles' ? 'titles'
        : result.action;
      runAction(action, { regenerate: true });
    }, [result, runAction]);

    const copyResult = useCallback(async () => {
      if (!result || result.type !== 'text') return;
      try {
        await navigator.clipboard.writeText(result.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch (error) {
        const message = error instanceof Error ? error.message : '复制失败';
        toast.error(message);
      }
    }, [result]);

    return (
      <motion.div
        initial={isMobile ? { y: '100%' } : { width: 0, opacity: 0, x: 30 }}
        animate={isMobile ? { y: 0 } : { width: 360, opacity: 1, x: 0 }}
        exit={isMobile ? { y: '100%' } : { width: 0, opacity: 0, x: 60 }}
        transition={isMobile ? { type: 'spring', damping: 30, stiffness: 260 } : { type: 'spring', stiffness: 320, damping: 30, mass: 0.6 }}
        className={cn(
          'flex flex-col relative',
          isMobile
            ? 'h-full w-full surface-overlay !rounded-none !rounded-t-2xl overflow-hidden'
            : 'overflow-visible h-full border-l border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-2xl z-30 shadow-xl'
        )}
      >
        {!isMobile && <div className="absolute inset-y-0 left-0 w-[1px] bg-gradient-to-b from-transparent via-primary/30 to-transparent" />}

        {isMobile && (
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-[var(--ink-tertiary)]/40" />
          </div>
        )}

        <div className={cn(
          'flex items-center justify-between px-5 border-b border-[var(--border-subtle)] shrink-0',
          isMobile ? 'py-3 bg-transparent' : 'py-4 bg-[var(--bg-secondary)]'
        )}>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--aurora-1)] shadow-[0_0_8px_color-mix(in_oklch,var(--aurora-1)_60%,transparent)]" />
            <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-[var(--ink-primary)]">AI 工具箱</span>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector
              variant="compact"
              className={cn(isMobile ? 'w-[180px]' : 'w-[160px]')}
              value={selectedModelId}
              selectedProviderCode={selectedProviderCode}
              modelType="chat"
              menuAlign="right"
              menuClassName={cn(isMobile ? 'w-[92vw] max-w-[92vw]' : 'w-[400px] max-w-[80vw]')}
              triggerClassName="!bg-[var(--bg-primary)] !border-[var(--border-subtle)] hover:!border-primary/40 !shadow-none"
              showArrow
              onChange={onModelChange}
            />
            <button
              onClick={onClose}
              className={cn(
                'rounded-full text-[var(--ink-tertiary)] hover:text-[var(--ink-primary)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] transition-colors',
                isMobile ? 'p-2' : 'p-1.5'
              )}
              aria-label="关闭 AI 面板"
            >
              <X className={cn(isMobile ? 'w-5 h-5' : 'w-4 h-4')} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-[var(--border-subtle)] space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>正文 {content.trim().length} 字</span>
            <span>摘要 {summary.trim().length} 字</span>
          </div>

          <div className="flex bg-[var(--bg-secondary)] rounded-lg p-1.5 gap-2">
            <label className="flex-1 flex items-center justify-between px-2 py-1.5 cursor-pointer rounded-md hover:bg-[var(--bg-card-hover)] transition-colors group">
              <span className="text-xs text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)]">划词 AI 菜单</span>
              <div className="relative inline-flex items-center">
                <input type="checkbox" className="sr-only peer" checked={enableSelectionAi} onChange={(e) => setEnableSelectionAi(e.target.checked)} />
                <div className="w-7 h-4 bg-[var(--border-subtle)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--border-default)] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
              </div>
            </label>
            <div className="w-px bg-[var(--border-subtle)] my-1" />
            <label className="flex-1 flex items-center justify-between px-2 py-1.5 cursor-pointer rounded-md hover:bg-[var(--bg-card-hover)] transition-colors group">
              <span className="text-xs text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)]">/ 唤出 AI 命令</span>
              <div className="relative inline-flex items-center">
                <input type="checkbox" className="sr-only peer" checked={enableSlashAi} onChange={(e) => setEnableSlashAi(e.target.checked)} />
                <div className="w-7 h-4 bg-[var(--border-subtle)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--border-default)] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary"></div>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {toolConfig.map((tool) => (
              <button
                key={tool.key}
                onClick={() => runAction(tool.key)}
                disabled={!canRun}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors',
                  activeAction === tool.key
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                  !canRun && 'opacity-60 cursor-not-allowed'
                )}
              >
                <tool.icon className="w-4 h-4" />
                <span>{tool.label}</span>
              </button>
            ))}
          </div>
          {activeAction === 'translate' && (
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-[var(--text-muted)]" />
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="flex-1 h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] px-2 focus:outline-none"
              >
                {languageOptions.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loadingAction && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <RefreshCw className="w-4 h-4 animate-spin" />
              AI 正在生成 {toolConfig.find(t => t.key === loadingAction)?.label}...
            </div>
          )}

          {!loadingAction && !result && (
            <div className="text-sm text-[var(--text-muted)] leading-relaxed">
              选择上方功能即可生成内容。支持在结果区域一键回填或插入到正文。
            </div>
          )}

          {!loadingAction && result?.type === 'text' && (
            <div className="space-y-3">
              <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed bg-[var(--bg-secondary)]/70 border border-[var(--border-subtle)] rounded-lg p-3 max-h-64 overflow-auto">
                {result.text}
              </div>

              {/* summary 工具：把"应用前 / 应用后"两段并列展示，避免一键写入后看不出差异 */}
              {result.action === 'summary' && (
                <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-3">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    <FileText className="w-3 h-3" />
                    应用预览
                  </div>
                  <div className="grid gap-2">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)] mb-1">当前摘要</div>
                      <div className="text-xs leading-relaxed text-[var(--text-secondary)] line-clamp-3">
                        {summary.trim() ? summary : <span className="italic text-[var(--text-muted)]">（空，应用后将首次写入）</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[var(--aurora-1)]">
                      <ArrowRight className="w-3 h-3" />
                      <span className="font-mono text-[10px] uppercase tracking-wider">应用后</span>
                    </div>
                    <div>
                      <div className="text-xs leading-relaxed text-[var(--text-primary)] line-clamp-3">
                        {result.text}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copyResult}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制'}
                </button>
                <button
                  onClick={regenerateCurrent}
                  disabled={loadingAction !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重新生成
                </button>
                {result.action === 'summary' && (
                  <button
                    onClick={() => onUpdateSummary(result.text)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    写入摘要
                  </button>
                )}
                {result.action === 'polish' || result.action === 'translate' ? (
                  <button
                    onClick={() => onReplaceContent(result.text)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90"
                  >
                    <Replace className="w-3.5 h-3.5" />
                    替换正文
                  </button>
                ) : (
                  <button
                    onClick={() => onInsertText(`\n\n${result.text}\n`)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    插入正文
                  </button>
                )}
              </div>
            </div>
          )}

          {!loadingAction && result?.type === 'tags' && (() => {
            // 选中的标签名（保留 AI 输出的原始拼写, 仅使用 lowercase 做 set 比较）
            const selectedNames = result.tags.filter((t) => selectedTagKeys.has(t.toLowerCase()));
            const diff = computeTagDiff(currentTagNames, selectedNames, tagApplyMode);

            const toggleTagKey = (key: string) => {
              setSelectedTagKeys((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            };

            const apply = async () => {
              if (selectedNames.length === 0) {
                toast.error('请至少勾选一个标签');
                return;
              }
              await onApplyTags(selectedNames, tagApplyMode);
            };

            return (
              <div className="space-y-3">
                {/* AI 推荐标签：可勾选 / 取消勾选 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                      AI 推荐 · 已选 {selectedNames.length} / {result.tags.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.tags.map((tag) => {
                      const key = tag.toLowerCase();
                      const isOn = selectedTagKeys.has(key);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTagKey(key)}
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-all active:scale-95',
                            isOn
                              ? 'bg-primary/10 text-primary border-primary/40'
                              : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-subtle)] line-through opacity-60 hover:opacity-100',
                          )}
                        >
                          {isOn ? <Check className="w-3 h-3" /> : <Hash className="w-3 h-3" />}
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 模式切换 */}
                <div className="flex bg-[var(--bg-secondary)] rounded-lg p-1 gap-1">
                  {([
                    { key: 'append' as const, label: '追加', icon: PlusCircle },
                    { key: 'replace' as const, label: '替换', icon: Replace },
                  ]).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTagApplyMode(key)}
                      className={cn(
                        'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors',
                        tagApplyMode === key
                          ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* 集合差量预览：保留 / 新增 / 移除（替换模式才会真删，追加模式仅做信息提示） */}
                <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-3">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    <ArrowRight className="w-3 h-3" />
                    应用后预览（共 {diff.finalList.length} 个标签）
                  </div>
                  {diff.keep.length > 0 && (
                    <TagDiffRow
                      label="保留"
                      tags={diff.keep}
                      tone="neutral"
                      icon={<Check className="w-3 h-3" />}
                    />
                  )}
                  {diff.add.length > 0 && (
                    <TagDiffRow
                      label="新增"
                      tags={diff.add}
                      tone="add"
                      icon={<PlusCircle className="w-3 h-3" />}
                    />
                  )}
                  {tagApplyMode === 'replace' && diff.remove.length > 0 && (
                    <TagDiffRow
                      label="移除"
                      tags={diff.remove}
                      tone="remove"
                      icon={<Minus className="w-3 h-3" />}
                    />
                  )}
                  {tagApplyMode === 'append' && diff.remove.length > 0 && (
                    <div className="text-[10px] text-[var(--ink-muted)] italic">
                      追加模式不会移除当前文章已有的 {diff.remove.length} 个标签
                    </div>
                  )}
                  {diff.finalList.length === 0 && (
                    <div className="text-[10px] text-[var(--ink-muted)] italic">
                      没有可应用的标签
                    </div>
                  )}
                </div>

                {/* 主操作 */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={apply}
                    disabled={selectedNames.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {tagApplyMode === 'replace' ? <Replace className="w-3.5 h-3.5" /> : <PlusCircle className="w-3.5 h-3.5" />}
                    {tagApplyMode === 'replace' ? '替换为已选' : '追加已选'}
                  </button>
                  <button
                    onClick={regenerateCurrent}
                    disabled={loadingAction !== null}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重新生成
                  </button>
                </div>
              </div>
            );
          })()}

          {!loadingAction && result?.type === 'titles' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/40 p-3 space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--ink-muted)]">当前标题</div>
                <div className="text-xs text-[var(--text-secondary)] truncate">
                  {title.trim() || <span className="italic text-[var(--text-muted)]">（空）</span>}
                </div>
                <div className="text-[10px] text-[var(--ink-muted)] italic mt-1">点击下方标题即可替换</div>
              </div>
              <div className="space-y-2">
                {result.titles.map((item, index) => (
                  <button
                    key={`${item}-${index}`}
                    onClick={() => onUpdateTitle(item)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-sm text-[var(--text-primary)] transition-colors"
                  >
                    {index + 1}. {item}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={regenerateCurrent}
                  disabled={loadingAction !== null}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重新生成
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }
);

AiSidePanel.displayName = 'AiSidePanel';

export default AiSidePanel;
