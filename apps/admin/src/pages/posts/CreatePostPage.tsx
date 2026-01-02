import { useState } from 'react';
import { Save, Eye, Settings, Sparkles } from 'lucide-react';

export function CreatePostPage() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAI, setShowAI] = useState(false);

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Editor Area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入文章标题..."
            className="text-2xl font-bold bg-transparent text-white placeholder:text-gray-500 focus:outline-none flex-1"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAI(!showAI)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                showAI ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              AI 助手
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                showSettings ? 'bg-primary text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              <Settings className="w-4 h-4" />
              设置
            </button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 text-gray-300 hover:bg-white/20 transition-colors">
              <Eye className="w-4 h-4" />
              预览
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors">
              <Save className="w-4 h-4" />
              保存
            </button>
          </div>
        </div>

        {/* Content Editor */}
        <div className="flex-1 p-6 overflow-auto">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="开始写作... 支持 Markdown 语法"
            className="w-full h-full bg-transparent text-white placeholder:text-gray-500 focus:outline-none resize-none text-lg leading-relaxed"
          />
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="w-80 border-l border-white/10 p-6 space-y-6 overflow-auto">
          <h3 className="text-lg font-semibold text-white">发布设置</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">分类</label>
              <select className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white">
                <option>选择分类</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">标签</label>
              <input
                type="text"
                placeholder="添加标签..."
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">封面图片</label>
              <div className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center">
                <p className="text-gray-400">点击或拖拽上传</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">摘要</label>
              <textarea
                rows={3}
                placeholder="文章摘要..."
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-500 resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* AI Panel */}
      {showAI && (
        <div className="w-80 border-l border-white/10 p-6 space-y-4 overflow-auto">
          <h3 className="text-lg font-semibold text-white">AI 助手</h3>
          
          <div className="space-y-3">
            <button className="w-full px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-left transition-colors">
              <p className="text-white font-medium">生成摘要</p>
              <p className="text-gray-400 text-sm">自动生成文章摘要</p>
            </button>
            <button className="w-full px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-left transition-colors">
              <p className="text-white font-medium">智能标签</p>
              <p className="text-gray-400 text-sm">AI 推荐文章标签</p>
            </button>
            <button className="w-full px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-left transition-colors">
              <p className="text-white font-medium">润色优化</p>
              <p className="text-gray-400 text-sm">优化文章表达</p>
            </button>
            <button className="w-full px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-left transition-colors">
              <p className="text-white font-medium">续写内容</p>
              <p className="text-gray-400 text-sm">AI 辅助续写</p>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CreatePostPage;
