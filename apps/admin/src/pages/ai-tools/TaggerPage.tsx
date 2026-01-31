import { useState } from 'react';
import { RefreshCw, Tags, X } from 'lucide-react';

export function TaggerPage() {
  const [input, setInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = () => {
    if (!input.trim()) return;
    setIsLoading(true);
    setTimeout(() => {
      setTags(['React', 'TypeScript', '前端开发', 'Web技术', 'AI']);
      setIsLoading(false);
    }, 1200);
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">智能标签</h1>
        <p className="text-gray-400 mt-1">AI 自动分析内容并推荐合适的标签</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">文章内容</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴文章内容，AI 将自动推荐标签..."
            className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">推荐标签</label>
          <div className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 overflow-auto">
            {isLoading ? (
              <div className="flex items-center gap-2 text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                AI 正在分析内容...
              </div>
            ) : tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/20 text-primary border border-primary/30"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="p-0.5 rounded-full hover:bg-primary/30"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-gray-500">推荐的标签将显示在这里</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleGenerate}
          disabled={isLoading || !input.trim()}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Tags className="w-5 h-5" />
          生成标签
        </button>
      </div>
    </div>
  );
}

export default TaggerPage;
