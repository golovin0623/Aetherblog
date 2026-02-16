import { forwardRef, useCallback, useImperativeHandle, useMemo, useState, type ComponentType } from 'react';
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
} from 'lucide-react';
import { aiService } from '@/services/aiService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ModelSelector } from '@/components/ai/ModelSelector';

export type AiPanelAction = 'summary' | 'tags' | 'titles' | 'polish' | 'outline' | 'translate';

export interface AiSidePanelHandle {
  runAction: (action: AiPanelAction) => void;
}

interface AiSidePanelProps {
  isMobile?: boolean;
  content: string;
  title: string;
  summary: string;
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

    const canRun = useMemo(() => content.trim().length > 0, [content]);

    const runAction = useCallback(async (action: AiPanelAction) => {
      if (!canRun) {
        toast.error('请先输入文章内容');
        return;
      }

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
          const res = await aiService.generateSummary({ content, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'text', action, text: res.data.summary });
          } else {
            toast.error(res.message || '摘要生成失败');
          }
        }

        if (action === 'tags') {
          const res = await aiService.extractTags({ content, maxTags: 6, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'tags', tags: res.data.tags });
          } else {
            toast.error(res.message || '标签提取失败');
          }
        }

        if (action === 'titles') {
          const res = await aiService.suggestTitles({ content, count: 6, style: 'seo', ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'titles', titles: res.data.titles });
          } else {
            toast.error(res.message || '标题生成失败');
          }
        }

        if (action === 'polish') {
          const res = await aiService.polishContent({ content, polishType: 'all', style: 'professional', ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'text', action, text: res.data.polishedContent });
          } else {
            toast.error(res.message || '润色失败');
          }
        }

        if (action === 'outline') {
          const topic = title.trim() || content.trim().slice(0, 100);
          const res = await aiService.generateOutline({ topic, existingContent: content, depth: 2, ...modelPayload });
          if (res.code === 200 && res.data) {
            setResult({ type: 'text', action, text: res.data.outline });
          } else {
            toast.error(res.message || '大纲生成失败');
          }
        }

        if (action === 'translate') {
          const res = await aiService.translateContent({ content, targetLanguage, ...modelPayload });
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

    useImperativeHandle(ref, () => ({ runAction }));

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
          'overflow-visible flex flex-col relative',
          isMobile
            ? 'h-full w-full bg-[var(--bg-primary)]'
            : 'h-full border-l border-[var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur-2xl z-30 shadow-xl'
        )}
      >
        {!isMobile && <div className="absolute inset-y-0 left-0 w-[1px] bg-gradient-to-b from-transparent via-primary/30 to-transparent" />}

        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(139,92,246,0.6)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)] tracking-wide uppercase">AI 写作面板</span>
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
              className="p-1.5 rounded-full hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all duration-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-[var(--border-subtle)] space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>正文 {content.trim().length} 字</span>
            <span>摘要 {summary.trim().length} 字</span>
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
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copyResult}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制'}
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

          {!loadingAction && result?.type === 'tags' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {result.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 text-xs rounded-full bg-primary/10 text-primary border border-primary/30"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onApplyTags(result.tags, 'replace')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90"
                >
                  <Hash className="w-3.5 h-3.5" />
                  替换标签
                </button>
                <button
                  onClick={() => onApplyTags(result.tags, 'append')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)]"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  追加标签
                </button>
              </div>
            </div>
          )}

          {!loadingAction && result?.type === 'titles' && (
            <div className="space-y-3">
              <div className="text-xs text-[var(--text-muted)]">点击标题即可替换当前标题</div>
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
            </div>
          )}
        </div>
      </motion.div>
    );
  }
);

AiSidePanel.displayName = 'AiSidePanel';

export default AiSidePanel;
