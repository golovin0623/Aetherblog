import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Wand2,
  Hash,
  Heading,
  Sparkles,
  ListTree,
  Loader2,
  Copy,
  CheckCircle,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { aiService } from '@/services/aiService';
import { toast } from 'sonner';

export function AiTestPage() {
  const [content, setContent] = useState('');
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<{
    summary?: string;
    tags?: string[];
    titles?: string[];
    polished?: string;
    outline?: string;
  }>({});

  // 生成摘要
  const handleGenerateSummary = async () => {
    if (!content.trim()) {
      toast.error('请先输入文章内容');
      return;
    }

    setLoading('summary');
    try {
      const res = await aiService.generateSummary({ content });
      if (res.code === 200 && res.data) {
        setResults(prev => ({ ...prev, summary: res.data!.summary }));
        toast.success('摘要生成成功');
      } else {
        toast.error(res.message || '生成摘要失败');
      }
    } catch (error: any) {
      toast.error(error.message || '生成摘要失败');
      console.error(error);
    } finally {
      setLoading(null);
    }
  };

  // 提取标签
  const handleExtractTags = async () => {
    if (!content.trim()) {
      toast.error('请先输入文章内容');
      return;
    }

    setLoading('tags');
    try {
      const res = await aiService.extractTags({ content, maxTags: 5 });
      if (res.code === 200 && res.data) {
        setResults(prev => ({ ...prev, tags: res.data!.tags }));
        toast.success(`提取到 ${res.data.tags.length} 个标签`);
      } else {
        toast.error(res.message || '提取标签失败');
      }
    } catch (error: any) {
      toast.error(error.message || '提取标签失败');
      console.error(error);
    } finally {
      setLoading(null);
    }
  };

  // 生成标题建议
  const handleSuggestTitles = async () => {
    if (!content.trim()) {
      toast.error('请先输入文章内容');
      return;
    }

    setLoading('titles');
    try {
      const res = await aiService.suggestTitles({ content, count: 5 });
      if (res.code === 200 && res.data) {
        setResults(prev => ({ ...prev, titles: res.data!.titles }));
        toast.success(`生成了 ${res.data.titles.length} 个标题建议`);
      } else {
        toast.error(res.message || '生成标题失败');
      }
    } catch (error: any) {
      toast.error(error.message || '生成标题失败');
      console.error(error);
    } finally {
      setLoading(null);
    }
  };

  // 内容润色
  const handlePolish = async () => {
    if (!content.trim()) {
      toast.error('请先输入文章内容');
      return;
    }

    setLoading('polish');
    try {
      const res = await aiService.polishContent({
        content,
        polishType: 'all',
        style: 'professional',
      });
      if (res.code === 200 && res.data) {
        setResults(prev => ({ ...prev, polished: res.data!.polishedContent }));
        toast.success('内容润色完成');
      } else {
        toast.error(res.message || '内容润色失败');
      }
    } catch (error: any) {
      toast.error(error.message || '内容润色失败');
      console.error(error);
    } finally {
      setLoading(null);
    }
  };

  // 生成大纲
  const handleGenerateOutline = async () => {
    const topicText = topic.trim() || content.trim().substring(0, 100);
    if (!topicText) {
      toast.error('请先输入主题或文章内容');
      return;
    }

    setLoading('outline');
    try {
      const res = await aiService.generateOutline({
        topic: topicText,
        existingContent: content,
        depth: 2,
      });
      if (res.code === 200 && res.data) {
        setResults(prev => ({ ...prev, outline: res.data!.outline }));
        toast.success('大纲生成成功');
      } else {
        toast.error(res.message || '生成大纲失败');
      }
    } catch (error: any) {
      toast.error(error.message || '生成大纲失败');
      console.error(error);
    } finally {
      setLoading(null);
    }
  };

  // 复制到剪贴板
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('已复制到剪贴板');
  };

  // 清除结果
  const clearResults = () => {
    setResults({});
    toast.success('已清除所有结果');
  };

  const aiTools = [
    {
      key: 'summary',
      icon: Wand2,
      label: '生成摘要',
      action: handleGenerateSummary,
      color: 'from-purple-500 to-pink-500',
    },
    {
      key: 'tags',
      icon: Hash,
      label: '提取标签',
      action: handleExtractTags,
      color: 'from-blue-500 to-cyan-500',
    },
    {
      key: 'titles',
      icon: Heading,
      label: '标题建议',
      action: handleSuggestTitles,
      color: 'from-green-500 to-emerald-500',
    },
    {
      key: 'polish',
      icon: Sparkles,
      label: '内容润色',
      action: handlePolish,
      color: 'from-orange-500 to-red-500',
    },
    {
      key: 'outline',
      icon: ListTree,
      label: '生成大纲',
      action: handleGenerateOutline,
      color: 'from-indigo-500 to-purple-500',
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 头部 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
          AI 功能测试
        </h1>
        <p className="text-[var(--text-secondary)]">
          测试所有 AI 辅助功能，验证后端 API 集成
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧：输入区 */}
        <div className="space-y-6">
          {/* 主题输入（可选，用于大纲） */}
          <div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)]">
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              主题（可选，用于生成大纲）
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：Spring Boot 4.0 新特性介绍"
              className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* 内容输入 */}
          <div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)]">
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              文章内容
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="在此输入文章内容进行测试..."
              rows={12}
              className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono text-sm"
            />
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {content.length} 字符
            </div>
          </div>

          {/* AI 工具按钮 */}
          <div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--text-secondary)]">
                AI 功能
              </h3>
              <button
                onClick={clearResults}
                className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                清除结果
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {aiTools.map((tool) => (
                <button
                  key={tool.key}
                  onClick={tool.action}
                  disabled={loading !== null}
                  className={`p-3 rounded-lg bg-gradient-to-br ${tool.color} text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95`}
                >
                  <div className="flex items-center gap-2">
                    {loading === tool.key ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <tool.icon className="w-4 h-4" />
                    )}
                    <span className="text-sm font-medium">{tool.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧：结果展示区 */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            AI 结果
          </h3>

          {/* 摘要 */}
          {results.summary && (
            <ResultCard
              title="摘要"
              icon={Wand2}
              color="purple"
              onCopy={() => copyToClipboard(results.summary!)}
            >
              <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                {results.summary}
              </p>
            </ResultCard>
          )}

          {/* 标签 */}
          {results.tags && results.tags.length > 0 && (
            <ResultCard
              title="提取的标签"
              icon={Hash}
              color="blue"
              onCopy={() => copyToClipboard(results.tags!.join(', '))}
            >
              <div className="flex flex-wrap gap-2">
                {results.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 bg-blue-500/20 text-blue-500 rounded-full text-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </ResultCard>
          )}

          {/* 标题建议 */}
          {results.titles && results.titles.length > 0 && (
            <ResultCard
              title="标题建议"
              icon={Heading}
              color="green"
              onCopy={() => copyToClipboard(results.titles!.join('\n'))}
            >
              <div className="space-y-2">
                {results.titles.map((title, index) => (
                  <div
                    key={index}
                    className="p-2 bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
                    onClick={() => copyToClipboard(title)}
                  >
                    <span className="text-xs text-[var(--text-muted)] mr-2">
                      {index + 1}.
                    </span>
                    <span className="text-[var(--text-primary)]">{title}</span>
                  </div>
                ))}
              </div>
            </ResultCard>
          )}

          {/* 润色后的内容 */}
          {results.polished && (
            <ResultCard
              title="润色后的内容"
              icon={Sparkles}
              color="orange"
              onCopy={() => copyToClipboard(results.polished!)}
            >
              <p className="text-[var(--text-primary)] whitespace-pre-wrap font-mono text-sm">
                {results.polished}
              </p>
            </ResultCard>
          )}

          {/* 大纲 */}
          {results.outline && (
            <ResultCard
              title="文章大纲"
              icon={ListTree}
              color="indigo"
              onCopy={() => copyToClipboard(results.outline!)}
            >
              <pre className="text-[var(--text-primary)] whitespace-pre-wrap font-mono text-sm">
                {results.outline}
              </pre>
            </ResultCard>
          )}

          {/* 空状态 */}
          {!results.summary &&
            !results.tags &&
            !results.titles &&
            !results.polished &&
            !results.outline && (
              <div className="p-8 bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)] text-center">
                <Wand2 className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3" />
                <p className="text-[var(--text-secondary)]">
                  选择左侧的 AI 功能开始测试
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

// 结果卡片组件
interface ResultCardProps {
  title: string;
  icon: any;
  color: string;
  onCopy: () => void;
  children: React.ReactNode;
}

function ResultCard({ title, icon: Icon, color, onCopy, children }: ResultCardProps) {
  const colorClasses = {
    purple: 'from-purple-500 to-pink-500',
    blue: 'from-blue-500 to-cyan-500',
    green: 'from-green-500 to-emerald-500',
    orange: 'from-orange-500 to-red-500',
    indigo: 'from-indigo-500 to-purple-500',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border-subtle)]"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg bg-gradient-to-br ${colorClasses[color as keyof typeof colorClasses]}`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <h4 className="text-sm font-medium text-[var(--text-primary)]">{title}</h4>
        </div>
        <button
          onClick={onCopy}
          className="p-1.5 hover:bg-[var(--bg-card-hover)] rounded-lg transition-colors"
          title="复制"
        >
          <Copy className="w-4 h-4 text-[var(--text-secondary)]" />
        </button>
      </div>
      <div className="mt-2">{children}</div>
    </motion.div>
  );
}
