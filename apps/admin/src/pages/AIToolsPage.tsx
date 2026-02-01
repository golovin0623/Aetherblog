import { useState, useEffect } from 'react';
import { Sparkles, BrainCircuit, Wand2, ListTree, Languages, PenLine, FileEdit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AIToolsWorkspace } from '@/components/ai/AIToolsWorkspace';
import { apiClient as api } from '@/services/api';
import { toast } from 'sonner';

const tools = [
  { id: 'summary', label: '智能摘要', desc: '自动生成文章摘要', icon: BrainCircuit },
  { id: 'tags', label: '智能标签', desc: '推荐相关标签', icon: Wand2 },
  { id: 'titles', label: '标题优化', desc: '优化文章标题', icon: FileEdit },
  { id: 'outline', label: '大纲生成', desc: '生成文章大纲', icon: ListTree },
  { id: 'polish', label: '内容润色', desc: '润色文章内容', icon: PenLine },
  { id: 'translate', label: '智能翻译', desc: '多语言翻译', icon: Languages },
];

export default function AIToolsPage() {
  const [selectedToolId, setSelectedToolId] = useState('summary');
  const [promptConfigs, setPromptConfigs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAllConfigs = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<any>('/v1/admin/ai/prompts');
      if (res.success) {
        setPromptConfigs(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch prompt configs:', err);
      toast.error('获取配置失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllConfigs();
  }, []);

  const selectedTool = tools.find(t => t.id === selectedToolId) || tools[0];

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">AI 工具箱</h1>
          <p className="text-[var(--text-muted)] mt-2 font-light">
            通过 AI 增强您的创作流程。您可以直接在此测试各种模型效果并调整 Prompt 模板。
          </p>
        </div>
      </div>

      {/* Tools Selector Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isSelected = selectedToolId === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => setSelectedToolId(tool.id)}
              className={cn(
                'group relative p-4 rounded-2xl text-left transition-all duration-300',
                'bg-[var(--bg-card)] border border-[var(--border-subtle)]',
                'hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30',
                isSelected ? 'ring-2 ring-primary/50 border-primary shadow-lg shadow-primary/10 bg-primary/[0.02]' : 'hover:scale-[1.02]'
              )}
            >
              <div className={cn(
                "p-2 w-fit rounded-xl mb-3 transition-colors",
                isSelected ? "bg-primary text-white" : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white"
              )}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="font-semibold text-sm text-[var(--text-primary)] leading-none mb-1.5">{tool.label}</div>
              <p className="text-[10px] text-[var(--text-muted)] leading-tight line-clamp-1 opacity-70">{tool.desc}</p>
              
            </button>
          );
        })}
      </div>

      {/* Workspace Area */}
      <div className="relative group p-[1px] rounded-[32px] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-[var(--border-subtle)] to-emerald-500/30 opacity-70 group-hover:opacity-100 transition-opacity duration-1000" />
        <div className="relative bg-[var(--bg-card)]/40 backdrop-blur-3xl rounded-[31px] p-8 md:p-12 min-h-[700px] border border-white/5 shadow-2xl">
          <div className="absolute top-0 left-1/4 w-1/2 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <AIToolsWorkspace 
            selectedTool={selectedTool} 
            allConfigs={promptConfigs}
            onConfigUpdated={fetchAllConfigs}
            isGlobalLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
