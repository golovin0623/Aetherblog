import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Save, Eye, ArrowLeft, Settings, Sparkles } from 'lucide-react';

export function EditPostPage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState('示例文章标题');
  const [content, setContent] = useState('这是文章的内容...');
  const [showSettings, setShowSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    // 模拟保存
    setTimeout(() => {
      setIsSaving(false);
    }, 1000);
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-4">
          <button className="p-2 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-xl font-bold bg-transparent text-[var(--text-primary)] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              showSettings ? 'bg-primary text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <Settings className="w-4 h-4" />
            设置
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]">
            <Eye className="w-4 h-4" />
            预览
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 flex">
        <div className="flex-1 p-6 overflow-auto">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full bg-transparent text-[var(--text-primary)] text-lg leading-relaxed focus:outline-none resize-none"
            placeholder="开始写作..."
          />
        </div>

        {showSettings && (
          <div className="w-80 border-l border-[var(--border-subtle)] p-6 space-y-6 overflow-auto bg-[var(--bg-card)]">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">文章设置</h3>
            
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-2">分类</label>
              <select className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                <option>技术</option>
                <option>生活</option>
                <option>随笔</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-2">标签</label>
              <input
                type="text"
                placeholder="添加标签..."
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-2">封面</label>
              <div className="border-2 border-dashed border-[var(--border-subtle)] rounded-lg p-6 text-center hover:bg-[var(--bg-card-hover)] transition-colors">
                <p className="text-[var(--text-muted)]">点击上传封面图</p>
              </div>
            </div>

            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-2">状态</label>
              <select className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)]">
                <option value="DRAFT">草稿</option>
                <option value="PUBLISHED">已发布</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EditPostPage;
