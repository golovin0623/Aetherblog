import { useState } from 'react';
import { Sparkles, Wand2, Lightbulb, RefreshCw, Tags, ChevronDown, ChevronUp, X } from 'lucide-react';

interface AiAssistantProps {
  content: string;
  onInsert: (text: string) => void;
}

export function AiAssistant({ content, onInsert }: AiAssistantProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const handleAction = async (action: string) => {
    setIsLoading(true);
    setSuggestions([]);

    // 模拟 AI 响应
    setTimeout(() => {
      if (action === 'continue') {
        setSuggestions(['这是 AI 生成的续写内容示例，可以直接插入到文章中...']);
      } else if (action === 'polish') {
        setSuggestions(['这是润色后的内容，语言更加流畅优美...']);
      } else if (action === 'summary') {
        setSuggestions(['文章摘要：本文主要介绍了...']);
      } else if (action === 'tags') {
        setSuggestions(['#技术', '#前端', '#AI', '#React', '#TypeScript']);
      }
      setIsLoading(false);
    }, 1500);
  };

  const actions = [
    { id: 'continue', label: '续写', icon: Wand2, color: 'text-purple-400' },
    { id: 'polish', label: '润色', icon: Sparkles, color: 'text-blue-400' },
    { id: 'summary', label: '摘要', icon: Lightbulb, color: 'text-yellow-400' },
    { id: 'tags', label: '标签', icon: Tags, color: 'text-green-400' },
  ];

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
      {/* 头部 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="font-medium text-white">AI 助手</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* 操作 */}
          <div className="grid grid-cols-2 gap-2">
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleAction(action.id)}
                disabled={isLoading || !content}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <action.icon className={`w-4 h-4 ${action.color}`} />
                <span className="text-sm text-gray-300">{action.label}</span>
              </button>
            ))}
          </div>

          {/* 加载中 */}
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin" />
              AI 正在处理...
            </div>
          )}

          {/* 建议 */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              {suggestions.map((suggestion, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-white/5 border border-white/10"
                >
                  <p className="text-sm text-gray-300">{suggestion}</p>
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => setSuggestions([])}
                      className="px-3 py-1 text-xs text-gray-400 hover:text-white"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        onInsert(suggestion);
                        setSuggestions([]);
                      }}
                      className="px-3 py-1 text-xs bg-primary text-white rounded"
                    >
                      插入
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!content && (
            <p className="text-xs text-gray-500">请先输入内容后使用 AI 助手</p>
          )}
        </div>
      )}
    </div>
  );
}

export default AiAssistant;
