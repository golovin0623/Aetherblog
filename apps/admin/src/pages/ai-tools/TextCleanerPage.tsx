import { useState } from 'react';
import { Sparkles, Send, RefreshCw } from 'lucide-react';

export function TextCleanerPage() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleClean = async () => {
    if (!input.trim()) return;
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setOutput(input.replace(/\s+/g, ' ').trim());
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">文本清洗</h1>
        <p className="text-gray-400 mt-1">AI 智能清洗文本，修正错别字，统一格式</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Input */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">输入文本</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴需要清洗的文本..."
            className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>

        {/* Output */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">输出结果</label>
          <div className="w-full h-80 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white overflow-auto">
            {isLoading ? (
              <div className="flex items-center gap-2 text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                处理中...
              </div>
            ) : (
              output || <span className="text-gray-500">结果将显示在这里</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleClean}
          disabled={isLoading || !input.trim()}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Sparkles className="w-5 h-5" />
          开始清洗
        </button>
      </div>
    </div>
  );
}

export default TextCleanerPage;
