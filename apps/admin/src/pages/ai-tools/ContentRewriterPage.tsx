import { useState } from 'react';
import { Wand2, RefreshCw } from 'lucide-react';

export function ContentRewriterPage() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [style, setStyle] = useState('formal');
  const [isLoading, setIsLoading] = useState(false);

  const styles = [
    { value: 'formal', label: '正式' },
    { value: 'casual', label: '轻松' },
    { value: 'concise', label: '简洁' },
    { value: 'detailed', label: '详细' },
  ];

  const handleRewrite = async () => {
    if (!input.trim()) return;
    setIsLoading(true);
    setTimeout(() => {
      setOutput(`[${style}风格重写] ${input}`);
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">内容重写</h1>
        <p className="text-gray-400 mt-1">AI 智能改写内容，调整风格和表达方式</p>
      </div>

      {/* Style Selection */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">改写风格:</span>
        {styles.map((s) => (
          <button
            key={s.value}
            onClick={() => setStyle(s.value)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              style === s.value
                ? 'bg-primary text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">原文</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入需要改写的内容..."
            className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">改写结果</label>
          <div className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white overflow-auto">
            {isLoading ? (
              <div className="flex items-center gap-2 text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                AI 正在改写...
              </div>
            ) : (
              output || <span className="text-gray-500">改写结果将显示在这里</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleRewrite}
          disabled={isLoading || !input.trim()}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Wand2 className="w-5 h-5" />
          开始改写
        </button>
      </div>
    </div>
  );
}

export default ContentRewriterPage;
