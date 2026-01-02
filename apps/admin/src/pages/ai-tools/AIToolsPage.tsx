import { Sparkles, FileText, Wand2, Zap, Bot, Search, Brain, Tags } from 'lucide-react';
import { Link } from 'react-router-dom';

export function AIToolsPage() {
  const tools = [
    {
      id: 'text-cleaner',
      name: '文本清洗',
      description: '清理文本格式，修正错别字',
      icon: FileText,
      color: 'from-blue-500 to-cyan-500',
      href: '/ai-tools/text-cleaner',
    },
    {
      id: 'content-rewriter',
      name: '内容重写',
      description: 'AI 智能改写，调整风格',
      icon: Wand2,
      color: 'from-purple-500 to-pink-500',
      href: '/ai-tools/content-rewriter',
    },
    {
      id: 'auto-summary',
      name: '智能摘要',
      description: '自动生成文章摘要',
      icon: Zap,
      color: 'from-orange-500 to-yellow-500',
      href: '/ai-tools/summary',
    },
    {
      id: 'auto-tagger',
      name: '智能标签',
      description: 'AI 自动推荐标签',
      icon: Tags,
      color: 'from-green-500 to-emerald-500',
      href: '/ai-tools/tagger',
    },
    {
      id: 'seo-optimizer',
      name: 'SEO优化',
      description: '优化标题和描述',
      icon: Search,
      color: 'from-red-500 to-rose-500',
      href: '/ai-tools/seo',
    },
    {
      id: 'smart-qa',
      name: '智能问答',
      description: '基于内容的RAG问答',
      icon: Brain,
      color: 'from-indigo-500 to-violet-500',
      href: '/ai-tools/qa',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">AI 工具</h1>
        <p className="text-gray-400 mt-1">使用 AI 提升内容创作效率</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {tools.map((tool) => (
          <Link
            key={tool.id}
            to={tool.href}
            className="group relative p-6 rounded-xl bg-white/5 border border-white/10 hover:border-primary/50 transition-all"
          >
            <div
              className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tool.color} flex items-center justify-center mb-4`}
            >
              <tool.icon className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-white group-hover:text-primary transition-colors">
              {tool.name}
            </h3>
            <p className="text-gray-400 mt-2">{tool.description}</p>
            <Sparkles className="absolute top-4 right-4 w-5 h-5 text-primary/50 group-hover:text-primary transition-colors" />
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="p-6 rounded-xl bg-gradient-to-r from-primary/20 to-purple-500/20 border border-primary/30">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-primary/30">
            <Bot className="w-8 h-8 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">AI 写作助手</h3>
            <p className="text-gray-400">在文章编辑器中使用 AI 助手进行续写、扩写和润色</p>
          </div>
          <Link
            to="/posts/create"
            className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            开始写作
          </Link>
        </div>
      </div>
    </div>
  );
}

export default AIToolsPage;
