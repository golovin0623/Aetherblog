// 供应商配置弹窗组件
// ref: §5.1 - AI Service 架构

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import type { AiProvider, CreateProviderRequest, UpdateProviderRequest } from '@/services/aiProviderService';
import { PROVIDER_TYPES, PRESET_PROVIDERS, getPresetProvider } from '../types';
import { useCreateProvider, useUpdateProvider } from '../hooks/useProviders';

interface ProviderDialogProps {
  mode: 'create' | 'edit';
  initial?: AiProvider | null;
  onClose: () => void;
}

export default function ProviderDialog({
  mode,
  initial,
  onClose,
}: ProviderDialogProps) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    display_name: '',
    api_type: 'openai_compat',
    base_url: '',
    doc_url: '',
    icon: '',
    is_enabled: true,
    priority: 100,
    capabilities: undefined as Record<string, unknown> | undefined,
  });
  const [usePreset, setUsePreset] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState('');

  const createMutation = useCreateProvider();
  const updateMutation = useUpdateProvider();

  // 初始化表单
  useEffect(() => {
    if (initial) {
      setForm({
        code: initial.code,
        name: initial.name,
        display_name: initial.display_name || '',
        api_type: initial.api_type,
        base_url: initial.base_url || '',
        doc_url: initial.doc_url || '',
        icon: initial.icon || '',
        is_enabled: initial.is_enabled,
        priority: initial.priority,
        capabilities: initial.capabilities || undefined,
      });
      setUsePreset(false);
    }
  }, [initial]);

  // 选择预设时自动填充
  useEffect(() => {
    if (usePreset && selectedPreset) {
      const preset = getPresetProvider(selectedPreset);
      if (preset) {
        setForm((prev) => ({
          ...prev,
          code: preset.code,
          name: preset.name,
          display_name: preset.displayName,
          api_type: preset.apiType,
          base_url: preset.baseUrl || '',
          doc_url: preset.docUrl || '',
          icon: preset.icon || '',
          priority: preset.priority ?? prev.priority,
          capabilities: preset.capabilities || preset.settings ? {
            ...(preset.capabilities || {}),
            ...(preset.description ? { description: preset.description } : {}),
            ...(preset.apiKeyUrl ? { apiKeyUrl: preset.apiKeyUrl } : {}),
            ...(preset.modelsUrl ? { modelsUrl: preset.modelsUrl } : {}),
            ...(preset.url ? { url: preset.url } : {}),
            ...(preset.checkModel ? { checkModel: preset.checkModel } : {}),
            ...(preset.settings ? { settings: preset.settings } : {}),
          } : undefined,
        }));
      }
    }
  }, [selectedPreset, usePreset]);

  useEffect(() => {
    if (!usePreset) {
      setForm((prev) => ({ ...prev, capabilities: undefined }));
    }
  }, [usePreset]);

  const handleSubmit = () => {
    if (mode === 'create') {
      const payload: CreateProviderRequest = {
        code: form.code,
        name: form.name,
        display_name: form.display_name || null,
        api_type: form.api_type,
        base_url: form.base_url || null,
        doc_url: form.doc_url || null,
        icon: form.icon || null,
        is_enabled: form.is_enabled,
        priority: form.priority,
        capabilities: form.capabilities,
      };
      createMutation.mutate(payload, { onSuccess: onClose });
    } else if (initial) {
      const payload: UpdateProviderRequest = {
        name: form.name,
        display_name: form.display_name || null,
        api_type: form.api_type,
        base_url: form.base_url || null,
        doc_url: form.doc_url || null,
        icon: form.icon || null,
        is_enabled: form.is_enabled,
        priority: form.priority,
      };
      updateMutation.mutate({ id: initial.id, data: payload }, { onSuccess: onClose });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[90vw] sm:w-full sm:max-w-md max-h-[80vh] flex flex-col rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden"
      >
        {/* 顶部环境光 */}
        <div className="absolute inset-0 rounded-[inherit] pointer-events-none z-10 overflow-hidden">
          <div 
            className="absolute inset-0 rounded-[inherit] border-t border-l border-r border-white/30 dark:border-white/10"
            style={{
              maskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 15%, transparent 60%)',
            }}
          />
        </div>

        {/* 头部 */}
        <div className="relative z-20 flex items-center justify-between p-5 bg-[var(--bg-primary)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {mode === 'create' ? '添加供应商' : '编辑供应商'}
          </h2>
          <motion.button
            onClick={onClose}
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* 表单内容区 - 独立滚动 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[var(--border-subtle)] scrollbar-track-transparent">
          <div className="p-5 space-y-4">
            {/* 预设选择 (仅创建时) */}
            {mode === 'create' && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
                    <input
                      type="radio"
                      checked={usePreset}
                      onChange={() => setUsePreset(true)}
                      className="accent-black dark:accent-white w-4 h-4"
                    />
                    使用预设
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
                    <input
                      type="radio"
                      checked={!usePreset}
                      onChange={() => setUsePreset(false)}
                      className="accent-black dark:accent-white w-4 h-4"
                    />
                    自定义
                  </label>
                </div>

                {usePreset && (
                  <select
                    value={selectedPreset}
                    onChange={(e) => setSelectedPreset(e.target.value)}
                    className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat"
                  >
                    <option value="">选择预设供应商</option>
                    {PRESET_PROVIDERS.map((preset) => (
                      <option key={preset.code} value={preset.code}>
                        {preset.icon} {preset.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Code */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-muted)]">
                供应商代码
                {mode === 'edit' && <span className="text-xs opacity-60 ml-1">(不可修改)</span>}
              </label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                disabled={mode === 'edit' || (mode === 'create' && usePreset)}
                placeholder="openai"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 disabled:opacity-50 transition-all"
              />
            </div>

            {/* 名称 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-muted)]">名称</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="OpenAI"
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-black dark:focus:border-white transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-muted)]">显示名称</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
                  placeholder="OpenAI"
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-black dark:focus:border-white transition-all"
                />
              </div>
            </div>

            {/* API 类型 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-muted)]">API 类型</label>
              <select
                value={form.api_type}
                onChange={(e) => setForm((prev) => ({ ...prev, api_type: e.target.value }))}
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center] bg-no-repeat"
              >
                {PROVIDER_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Base URL */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-muted)]">Base URL</label>
              <input
                type="text"
                value={form.base_url}
                onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-black dark:focus:border-white transition-all"
              />
            </div>

            {/* 文档地址 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-muted)]">文档地址</label>
              <input
                type="text"
                value={form.doc_url}
                onChange={(e) => setForm((prev) => ({ ...prev, doc_url: e.target.value }))}
                placeholder="https://docs.example.com"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-black dark:focus:border-white transition-all"
              />
            </div>

            {/* 图标 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label htmlFor="provider-icon" className="text-sm font-medium text-[var(--text-muted)] cursor-pointer">
                  图标
                </label>
                <span className="text-[10px] text-[var(--text-muted)] opacity-50 uppercase tracking-wider">可选</span>
              </div>
              
              {/* 快速选择图标 */}
              <div className="flex flex-wrap gap-2 p-1">
                {['🤖', '💬', '🧠', '☁️', '⚡', '🌈', '🎨', '✨', '🔥', '🚀'].map((emoji) => (
                  <motion.button
                    key={emoji}
                    type="button"
                    whileHover={{ scale: 1.1, backgroundColor: 'var(--bg-card-hover)' }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setForm((prev) => ({ ...prev, icon: emoji }))}
                    className={`w-9 h-9 flex items-center justify-center rounded-lg border transition-all ${
                      form.icon === emoji 
                        ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black shadow-sm' 
                        : 'border-[var(--border-default)] bg-[var(--bg-card)]'
                    }`}
                  >
                    <span className="text-base">{emoji}</span>
                  </motion.button>
                ))}
              </div>

              <div className="relative group">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg pointer-events-none z-10 select-none transition-transform group-focus-within:scale-110">
                  {form.icon || '🤖'}
                </div>
                <input
                  id="provider-icon"
                  type="text"
                  value={form.icon}
                  onChange={(e) => setForm((prev) => ({ ...prev, icon: e.target.value }))}
                  placeholder="输入 Emoji 或从上方选择..."
                  className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/5 transition-all"
                />
              </div>
            </div>

            {/* 启用状态 */}
            <label className="flex items-center gap-3 text-sm text-[var(--text-muted)] cursor-pointer group p-1">
              <div className="relative flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={form.is_enabled}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_enabled: e.target.checked }))}
                  className="peer appearance-none w-5 h-5 rounded-md border border-[var(--border-default)] checked:bg-black dark:checked:bg-white checked:border-transparent transition-all cursor-pointer"
                />
                <X className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity rotate-45 scale-125 translate-x-[0.5px] -translate-y-[0.5px] pointer-events-none" />
              </div>
              <span className="group-hover:text-[var(--text-primary)] transition-colors select-none font-medium">启用该供应商</span>
            </label>
          </div>
        </div>

        {/* 底部操作 - 固定 */}
        <div className="relative z-20 flex justify-end gap-3 p-5 bg-[var(--bg-primary)]">
          <motion.button
            onClick={onClose}
            whileHover={{ scale: 1.02, backgroundColor: 'var(--bg-card-hover)' }}
            whileTap={{ scale: 0.98 }}
            className="px-5 py-2.5 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] text-sm font-medium transition-colors"
          >
            取消
          </motion.button>
          <motion.button
            onClick={handleSubmit}
            disabled={isPending || !form.code || !form.name}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-black dark:bg-white text-white dark:text-black text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-sm active:scale-95"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            保存
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
