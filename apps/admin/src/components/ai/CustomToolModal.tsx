/**
 * @file CustomToolModal.tsx
 * @description 自定义 AI 工具配置弹窗
 * @ref §3.2 - 核心组件设计
 * @author AI Assistant
 */

import React, { useState, useEffect } from 'react';
import { 
  Modal, 
  Input, 
  Textarea, 
  Button 
} from "@aetherblog/ui";
import { AiTaskType } from '@/services/aiProviderService';
import { Box, Code, Type, MessageSquare, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface CustomToolModalProps {
  isOpen: boolean;
  onClose: () => void;
  tool?: AiTaskType | null;
  onSave: (tool: Partial<AiTaskType>) => Promise<void>;
  onDelete?: (code: string) => Promise<void>;
  isSaving?: boolean;
}

export const CustomToolModal: React.FC<CustomToolModalProps> = ({
  isOpen,
  onClose,
  tool,
  onSave,
  onDelete,
  isSaving = false
}) => {
  const [formData, setFormData] = useState<Partial<AiTaskType>>({
    code: '',
    name: '',
    description: '',
    prompt_template: ''
  });

  useEffect(() => {
    if (tool) {
      setFormData({
        code: tool.code,
        name: tool.name,
        description: tool.description || '',
        prompt_template: tool.prompt_template || ''
      });
    } else {
      setFormData({
        code: '',
        name: '',
        description: '',
        prompt_template: ''
      });
    }
  }, [tool, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.code || !formData.prompt_template) {
      toast.error('请填写完整信息');
      return;
    }
    
    // Simple code validation: alphanumeric and underscores only
    if (!/^[a-z0-9_]+$/.test(formData.code)) {
      toast.error('任务标识只能包含小写字母、数字和下划线');
      return;
    }

    await onSave(formData);
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={tool ? '编辑自定义工具' : '新建自定义工具'}
      size="lg"
    >
      <div className="text-[var(--text-muted)] text-xs sm:text-sm mb-4 sm:mb-6">
        配置您的自定义 AI 处理流程。提示词模板中使用 {'{content}'} 作为输入占位符。
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        <div className="space-y-3 sm:space-y-4">
          <div className="grid gap-2">
            <label htmlFor="code" className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <Code className="w-3 h-3" />
              任务标识 (ID)
            </label>
            <Input
              id="code"
              placeholder="例如: translation_en"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              disabled={!!tool}
              className="bg-[var(--bg-card)] border-[var(--border-subtle)]"
            />
            <p className="text-[10px] text-[var(--text-muted)] px-1">唯一标识符，创建后不可修改</p>
          </div>

          <div className="grid gap-2">
            <label htmlFor="name" className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <Type className="w-3 h-3" />
              工具名称
            </label>
            <Input
              id="name"
              placeholder="例如: 英语翻译"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="bg-[var(--bg-card)] border-[var(--border-subtle)]"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="description" className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <MessageSquare className="w-3 h-3" />
              描述
            </label>
            <Input
              id="description"
              placeholder="简短描述该工具的功能"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="bg-[var(--bg-card)] border-[var(--border-subtle)]"
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="prompt_template" className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                <Save className="w-3 h-3" />
                提示词模板
              </label>
            </div>
            <Textarea
              id="prompt_template"
              placeholder="例如: 请将以下内容翻译为英语:\n\n{content}"
              value={formData.prompt_template || ''}
              onChange={(e) => setFormData({ ...formData, prompt_template: e.target.value })}
              className="min-h-[120px] sm:min-h-[150px] bg-[var(--bg-card)] border-[var(--border-subtle)] font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row justify-between items-stretch sm:items-center gap-3 pt-4 border-t border-[var(--border-subtle)]">
          <div className="flex justify-center sm:justify-start">
            {tool && onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => tool.code && onDelete(tool.code)}
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10 gap-2 px-3 w-full sm:w-auto"
              >
                <Trash2 className="w-4 h-4" />
                删除
              </Button>
            )}
          </div>
          <div className="flex gap-2 sm:gap-3">
            <Button type="button" variant="secondary" onClick={onClose} size="sm" className="flex-1 sm:flex-none px-4 sm:px-6">
              取消
            </Button>
            <Button type="submit" loading={isSaving} size="sm" className="flex-1 sm:flex-none gap-2 px-4 sm:px-6">
              <Save className="w-4 h-4" />
              {isSaving ? '保存中...' : '提交保存'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
