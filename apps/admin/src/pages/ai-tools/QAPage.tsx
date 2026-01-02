import { useState } from 'react';
import { Send, Bot, User, RefreshCw } from 'lucide-react';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

export function QAPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now(),
      role: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simulate AI response
    setTimeout(() => {
      const aiMessage: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `基于您博客中的相关内容，这是关于"${input}"的回答：\n\n这是一个模拟的 RAG 回答，实际使用中会基于您的文章内容进行语义检索，然后由 AI 生成相关回答。`,
      };
      setMessages((prev) => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">智能问答</h1>
        <p className="text-gray-400 mt-1">基于您的博客内容进行 RAG 智能问答</p>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-white/5 border border-white/10 rounded-xl overflow-hidden flex flex-col">
        <div className="flex-1 p-6 overflow-auto space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500">
              <Bot className="w-16 h-16 mb-4 text-gray-600" />
              <p className="text-lg">开始提问</p>
              <p className="text-sm mt-1">AI 将基于您的博客内容回答问题</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[70%] px-4 py-3 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-primary text-white'
                      : 'bg-white/10 text-white'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <RefreshCw className="w-4 h-4 text-primary animate-spin" />
              </div>
              <div className="px-4 py-3 rounded-2xl bg-white/10 text-gray-400">
                思考中...
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-white/10">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="输入您的问题..."
              className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="px-4 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default QAPage;
