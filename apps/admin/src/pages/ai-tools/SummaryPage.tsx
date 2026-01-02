import { useState } from 'react';
import { RefreshCw, Lightbulb } from 'lucide-react';

export function SummaryPage() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [isLoading, setIsLoading] = useState(false);

  const lengthOptions = [
    { value: 'short', label: '简短', chars: '50-100字' },
    { value: 'medium', label: '适中', chars: '100-200字' },
    { value: 'long', label: '详细', chars: '200-300字' },
  ];

  const handleGenerate = () => {
    if (!input.trim()) return;
    setIsLoading(true);
    setTimeout(() => {
      setOutput(`[${length}摘要] ${input.substring(0, 100)}...`);
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">智能摘要</h1>
        <p className="text-gray-400 mt-1">AI 自动生成文章摘要，支持多种长度</p>
      </div>

      {/* Length Selection */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-400">摘要长度:</span>
        {lengthOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setLength(opt.value as typeof length)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              length === opt.value
                ? 'bg-primary text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-xs ml-1 opacity-70">({opt.chars})</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">文章内容</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴文章内容..."
            className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">生成摘要</label>
          <div className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white overflow-auto">
            {isLoading ? (
              <div className="flex items-center gap-2 text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                AI 正在生成摘要...
              </div>
            ) : (
              output || <span className="text-gray-500">摘要将显示在这里</span>
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
          <Lightbulb className="w-5 h-5" />
          生成摘要
        </button>
      </div>
    </div>
  );
}

export default SummaryPage;
