import { useState, useRef, useCallback } from 'react';
import {
  Bold, Italic, Strikethrough, Code, Link, Image, List, ListOrdered,
  Quote, Heading1, Heading2, Heading3, Minus, Eye, Edit, MoreHorizontal
} from 'lucide-react';

interface PostEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function PostEditor({ value, onChange }: PostEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  const insertText = useCallback((before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);
    const newText = value.substring(0, start) + before + selectedText + after + value.substring(end);
    
    onChange(newText);
    
    // Reset cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  }, [value, onChange]);

  const toolbarButtons = [
    { icon: Bold, action: () => insertText('**', '**'), title: '粗体' },
    { icon: Italic, action: () => insertText('*', '*'), title: '斜体' },
    { icon: Strikethrough, action: () => insertText('~~', '~~'), title: '删除线' },
    { icon: Code, action: () => insertText('`', '`'), title: '代码' },
    null, // Divider
    { icon: Heading1, action: () => insertText('# '), title: '标题1' },
    { icon: Heading2, action: () => insertText('## '), title: '标题2' },
    { icon: Heading3, action: () => insertText('### '), title: '标题3' },
    null,
    { icon: List, action: () => insertText('- '), title: '无序列表' },
    { icon: ListOrdered, action: () => insertText('1. '), title: '有序列表' },
    { icon: Quote, action: () => insertText('> '), title: '引用' },
    null,
    { icon: Link, action: () => insertText('[', '](url)'), title: '链接' },
    { icon: Image, action: () => insertText('![alt](', ')'), title: '图片' },
    { icon: Minus, action: () => insertText('\n---\n'), title: '分隔线' },
  ];

  return (
    <div className="flex flex-col h-full border border-white/10 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-0.5">
          {toolbarButtons.map((btn, i) =>
            btn === null ? (
              <div key={i} className="w-px h-5 bg-white/20 mx-1" />
            ) : (
              <button
                key={i}
                onClick={btn.action}
                title={btn.title}
                className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              >
                <btn.icon className="w-4 h-4" />
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPreview(false)}
            className={`p-1.5 rounded ${!showPreview ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/10'}`}
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowPreview(true)}
            className={`p-1.5 rounded ${showPreview ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/10'}`}
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Editor / Preview */}
      <div className="flex-1 overflow-auto">
        {showPreview ? (
          <div className="p-4 prose prose-invert max-w-none">
            {/* Simple preview - in real app use markdown parser */}
            <pre className="whitespace-pre-wrap">{value}</pre>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="使用 Markdown 开始写作..."
            className="w-full h-full p-4 bg-transparent text-white placeholder:text-gray-500 focus:outline-none resize-none font-mono text-sm leading-relaxed"
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/10 bg-white/5 text-xs text-gray-500">
        <span>Markdown</span>
        <span>{value.length} 字符</span>
      </div>
    </div>
  );
}

export default PostEditor;
