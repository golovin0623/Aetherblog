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
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-2xl"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {mode === 'create' ? '添加供应商' : '编辑供应商'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单 */}
        <div className="p-5 space-y-4">
          {/* 预设选择 (仅创建时) */}
          {mode === 'create' && (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <input
                    type="radio"
                    checked={usePreset}
                    onChange={() => setUsePreset(true)}
                    className="accent-primary"
                  />
                  使用预设
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <input
                    type="radio"
                    checked={!usePreset}
                    onChange={() => setUsePreset(false)}
                    className="accent-primary"
                  />
                  自定义
                </label>
              </div>

              {usePreset && (
                <select
                  value={selectedPreset}
                  onChange={(e) => setSelectedPreset(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
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
            <label className="text-sm text-[var(--text-muted)]">
              供应商代码
              {mode === 'edit' && <span className="text-xs opacity-60 ml-1">(不可修改)</span>}
            </label>
            <input
              type="text"
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              disabled={mode === 'edit' || (mode === 'create' && usePreset)}
              placeholder="openai"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40 disabled:opacity-50"
            />
          </div>

          {/* 名称 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="OpenAI"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[var(--text-muted)]">显示名称</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
                placeholder="OpenAI"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>

          {/* API 类型 */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-muted)]">API 类型</label>
            <select
              value={form.api_type}
              onChange={(e) => setForm((prev) => ({ ...prev, api_type: e.target.value }))}
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-primary/40"
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
            <label className="text-sm text-[var(--text-muted)]">Base URL</label>
            <input
              type="text"
              value={form.base_url}
              onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40"
            />
          </div>

          {/* 文档地址 */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-muted)]">文档地址</label>
            <input
              type="text"
              value={form.doc_url}
              onChange={(e) => setForm((prev) => ({ ...prev, doc_url: e.target.value }))}
              placeholder="https://docs.example.com"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40"
            />
          </div>

          {/* 图标 */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-muted)]">图标</label>
            <input
              type="text"
              value={form.icon}
              onChange={(e) => setForm((prev) => ({ ...prev, icon: e.target.value }))}
              placeholder="🤖"
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]/50 focus:outline-none focus:border-primary/40"
            />
          </div>

          {/* 启用状态 */}
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={form.is_enabled}
              onChange={(e) => setForm((prev) => ({ ...prev, is_enabled: e.target.checked }))}
              className="accent-primary"
            />
            启用该供应商
          </label>
        </div>

        {/* 底部操作 */}
        <div className="flex justify-end gap-3 p-5 border-t border-[var(--border-default)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[var(--border-default)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !form.code || !form.name}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            保存
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
