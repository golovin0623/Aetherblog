import { useState } from 'react';
import { RefreshCw, Search, Copy, Check } from 'lucide-react';

export function SeoOptimizerPage() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{
    title: string;
    metaDescription: string;
    keywords: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const handleOptimize = () => {
    if (!input.trim()) return;
    setIsLoading(true);
    setTimeout(() => {
      setResult({
        title: '【深度解析】文章标题优化建议 - 关键词覆盖',
        metaDescription: '本文详细介绍了SEO优化的最佳实践，包括关键词布局、标题优化、内容结构等核心要点，帮助您提升搜索引擎排名。',
        keywords: ['SEO优化', '搜索引擎', '关键词', '内容营销', '网站排名'],
      });
      setIsLoading(false);
    }, 1500);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">SEO 优化</h1>
        <p className="text-gray-400 mt-1">AI 生成 SEO 友好的标题、描述和关键词</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">文章内容</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴文章内容，获取SEO优化建议..."
            className="w-full h-96 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>

        <div className="space-y-4">
          {isLoading ? (
            <div className="h-96 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <div className="flex items-center gap-2 text-gray-400">
                <RefreshCw className="w-5 h-5 animate-spin" />
                AI 正在分析...
              </div>
            </div>
          ) : result ? (
            <>
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">优化标题</span>
                  <button
                    onClick={() => copyToClipboard(result.title, 'title')}
                    className="p-1.5 rounded hover:bg-white/10"
                  >
                    {copied === 'title' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
                <p className="text-white">{result.title}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">Meta 描述</span>
                  <button
                    onClick={() => copyToClipboard(result.metaDescription, 'meta')}
                    className="p-1.5 rounded hover:bg-white/10"
                  >
                    {copied === 'meta' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
                <p className="text-white">{result.metaDescription}</p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <span className="text-sm text-gray-400 block mb-2">推荐关键词</span>
                <div className="flex flex-wrap gap-2">
                  {result.keywords.map((kw) => (
                    <span key={kw} className="px-3 py-1 rounded-full bg-primary/20 text-primary text-sm">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="h-96 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <span className="text-gray-500">优化建议将显示在这里</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleOptimize}
          disabled={isLoading || !input.trim()}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Search className="w-5 h-5" />
          优化 SEO
        </button>
      </div>
    </div>
  );
}

export default SeoOptimizerPage;
