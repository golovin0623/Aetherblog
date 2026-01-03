import React, { useState, useEffect } from 'react';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview, markdownPreviewStyles } from './MarkdownPreview';
import { Edit, Eye, Columns } from 'lucide-react';

export interface EditorWithPreviewProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

type ViewMode = 'edit' | 'preview' | 'split';

export function EditorWithPreview({ value, onChange, className = '' }: EditorWithPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split');

  // Inject markdown preview styles
  useEffect(() => {
    const styleId = 'markdown-preview-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = markdownPreviewStyles;
      document.head.appendChild(style);
    }
    return () => {
      // Don't remove the styles on unmount - they might be used by other instances
    };
  }, []);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-white/10 bg-white/5">
        <button
          onClick={() => setViewMode('edit')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            viewMode === 'edit' ? 'bg-primary text-white' : 'text-gray-400 hover:bg-white/10'
          }`}
        >
          <Edit className="w-4 h-4" />
          编辑
        </button>
        <button
          onClick={() => setViewMode('preview')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            viewMode === 'preview' ? 'bg-primary text-white' : 'text-gray-400 hover:bg-white/10'
          }`}
        >
          <Eye className="w-4 h-4" />
          预览
        </button>
        <button
          onClick={() => setViewMode('split')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            viewMode === 'split' ? 'bg-primary text-white' : 'text-gray-400 hover:bg-white/10'
          }`}
        >
          <Columns className="w-4 h-4" />
          分屏
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'edit' && (
          <div className="flex-1 overflow-auto">
            <MarkdownEditor value={value} onChange={onChange} />
          </div>
        )}
        {viewMode === 'preview' && (
          <div className="flex-1 overflow-auto p-6">
            <MarkdownPreview content={value} />
          </div>
        )}
        {viewMode === 'split' && (
          <>
            <div className="flex-1 overflow-auto border-r border-white/10">
              <MarkdownEditor value={value} onChange={onChange} />
            </div>
            <div className="flex-1 overflow-auto p-6">
              <MarkdownPreview content={value} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default EditorWithPreview;
