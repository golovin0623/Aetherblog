import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const tools = [
  { id: 'summary', label: '智能摘要', desc: '自动生成文章摘要' },
  { id: 'tags', label: '智能标签', desc: '推荐相关标签' },
  { id: 'title', label: '标题优化', desc: '优化文章标题' },
  { id: 'outline', label: '大纲生成', desc: '生成文章大纲' },
  { id: 'polish', label: '内容润色', desc: '润色文章内容' },
  { id: 'translate', label: '智能翻译', desc: '多语言翻译' },
];

export default function AIToolsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">AI 工具</h1>
        <p className="text-gray-400 mt-1">AI 驱动的智能写作助手</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={cn(
              'p-6 rounded-xl text-left',
              'bg-white/5 border border-white/10',
              'hover:border-primary/50 hover:bg-white/10',
              'transition-all duration-300'
            )}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <span className="font-medium text-white">{tool.label}</span>
            </div>
            <p className="text-sm text-gray-400">{tool.desc}</p>
          </button>
        ))}
      </div>

      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        <div className="text-center py-12 text-gray-500">
          AI 工具工作区（待实现）
        </div>
      </div>
    </div>
  );
}
