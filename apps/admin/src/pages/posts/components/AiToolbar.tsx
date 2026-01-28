import { useState } from 'react';
import {
  Wand2,
  Hash,
  Heading,
  Sparkles,
  ListTree,
  Loader2,
  ChevronDown,
  X,
} from 'lucide-react';
import { aiService, type SummaryResponse, type TagsResponse, type TitlesResponse, type PolishResponse, type OutlineResponse } from '@/services/aiService';
import { toast } from 'sonner';

interface AiToolbarProps {
  content: string;
  onInsertText: (text: string) => void;
  onReplaceTags: (tags: string[]) => void;
}

export function AiToolbar({ content, onInsertText, onReplaceTags }: AiToolbarProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [showTitles, setShowTitles] = useState(false);
  const [titles, setTitles] = useState<string[]>([]);

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
        onInsertText(`\n\n## 摘要\n\n${res.data.summary}\n\n`);
        toast.success('摘要生成成功');
      } else {
        toast.error(res.message || '生成摘要失败');
      }
    } catch (error: any) {
      toast.error(error.message || '生成摘要失败');
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
        onReplaceTags(res.data.tags);
        toast.success(`提取到 ${res.data.tags.length} 个标签`);
      } else {
        toast.error(res.message || '提取标签失败');
      }
    } catch (error: any) {
      toast.error(error.message || '提取标签失败');
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
        setTitles(res.data.titles);
        setShowTitles(true);
        toast.success(`生成了 ${res.data.titles.length} 个标题建议`);
      } else {
        toast.error(res.message || '生成标题失败');
      }
    } catch (error: any) {
      toast.error(error.message || '生成标题失败');
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
        style: 'professional'
      });
      if (res.code === 200 && res.data) {
        onInsertText(res.data.polishedContent);
        if (res.data.changes) {
          toast.success(`润色完成：${res.data.changes}`);
        } else {
          toast.success('内容润色完成');
        }
      } else {
        toast.error(res.message || '内容润色失败');
      }
    } catch (error: any) {
      toast.error(error.message || '内容润色失败');
    } finally {
      setLoading(null);
    }
  };

  // 生成大纲
  const handleGenerateOutline = async () => {
    // 提取前100字作为主题
    const topic = content.trim().substring(0, 100);
    if (!topic) {
      toast.error('请先输入文章内容或主题');
      return;
    }

    setLoading('outline');
    try {
      const res = await aiService.generateOutline({ 
        topic,
        existingContent: content,
        depth: 2
      });
      if (res.code === 200 && res.data) {
        onInsertText(`\n\n${res.data.outline}\n\n`);
        toast.success('大纲生成成功');
      } else {
        toast.error(res.message || '生成大纲失败');
      }
    } catch (error: any) {
      toast.error(error.message || '生成大纲失败');
    } finally {
      setLoading(null);
    }
  };

  const aiTools = [
    {
      key: 'summary',
      icon: Wand2,
      label: '生成摘要',
      action: handleGenerateSummary,
    },
    {
      key: 'tags',
      icon: Hash,
      label: '提取标签',
      action: handleExtractTags,
    },
    {
      key: 'titles',
      icon: Heading,
      label: '标题建议',
      action: handleSuggestTitles,
    },
    {
      key: 'polish',
      icon: Sparkles,
      label: '内容润色',
      action: handlePolish,
    },
    {
      key: 'outline',
      icon: ListTree,
      label: '生成大纲',
      action: handleGenerateOutline,
    },
  ];

  return (
    <div className="relative">
      {/* AI 工具栏 */}
      <div className="flex items-center gap-1 p-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-lg">
        <Wand2 className="w-4 h-4 text-purple-500" />
        <span className="text-xs font-medium text-purple-600 dark:text-purple-400 mr-2">
          AI 助手
        </span>
        <div className="flex items-center gap-1">
          {aiTools.map((tool) => (
            <button
              key={tool.key}
              onClick={tool.action}
              disabled={loading !== null}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200/50 dark:border-gray-700/50"
              title={tool.label}
            >
              {loading === tool.key ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <tool.icon className="w-3.5 h-3.5" />
              )}
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 标题建议弹窗 */}
      {showTitles && titles.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              标题建议
            </h4>
            <button
              onClick={() => setShowTitles(false)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {titles.map((title, index) => (
              <button
                key={index}
                onClick={() => {
                  // 这里应该调用父组件的标题更新函数
                  navigator.clipboard.writeText(title);
                  toast.success('标题已复制到剪贴板');
                }}
                className="w-full text-left p-2 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300 transition-colors"
              >
                {index + 1}. {title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
