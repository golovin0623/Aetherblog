// 供应商详情面板组件
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { AiProvider } from '@/services/aiProviderService';
import { getPresetProvider } from '../types';
import { useToggleProvider, useDeleteProvider } from '../hooks/useProviders';
import { useProviderCredentials } from '../hooks/useCredentials';
import { useProviderModels } from '../hooks/useModels';
import ProviderIcon from './ProviderIcon';
import CredentialForm from './CredentialForm';
import ConnectionTest from './ConnectionTest';
import ModelList from './ModelList';

interface ProviderDetailProps {
  provider: AiProvider;
  onBack: () => void;
  onEdit: () => void;
}

export default function ProviderDetail({
  provider,
  onBack,
  onEdit,
}: ProviderDetailProps) {
  const [showMenu, setShowMenu] = useState(false);

  const preset = getPresetProvider(provider.code);

  const toggleMutation = useToggleProvider();
  const deleteMutation = useDeleteProvider();

  // 获取凭证
  const { data: credentials = [] } = useProviderCredentials(provider.code);
  const defaultCredential = credentials.find((c) => c.is_default) || credentials[0];

  // 获取模型
  const { data: models = [], isLoading: modelsLoading } = useProviderModels(provider.code);

  const handleToggle = (enabled: boolean) => {
    toggleMutation.mutate({ id: provider.id, enabled });
  };

  const handleDelete = () => {
    if (!confirm('确定删除该供应商吗？这将同时删除所有关联的模型和凭证。')) return;
    deleteMutation.mutate(provider.id, {
      onSuccess: () => onBack(),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="h-full flex flex-col"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <ProviderIcon code={provider.code} size={28} />
            <div>
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                {provider.display_name || provider.name}
              </h1>
              {preset?.docUrl && (
                <a
                  href={preset.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  查看文档 <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 启用开关 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-muted)]">
              {provider.is_enabled ? '已启用' : '已禁用'}
            </span>
            <button
              onClick={() => handleToggle(!provider.is_enabled)}
              disabled={toggleMutation.isPending}
              className={`relative w-12 h-6 rounded-full transition-all duration-300 ${
                provider.is_enabled
                  ? 'bg-primary shadow-lg shadow-primary/30'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              <motion.div
                layout
                className={`absolute top-1 w-4 h-4 rounded-full transition-all ${
                  provider.is_enabled
                    ? 'left-7 bg-white'
                    : 'left-1 bg-white/60'
                }`}
              />
            </button>
          </div>

          {/* 更多菜单 */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-xl hover:bg-white/5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-xl border border-white/10 bg-[var(--bg-card)] shadow-xl py-1">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onEdit();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-white/5"
                  >
                    <Pencil className="w-4 h-4" />
                    编辑供应商
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      handleDelete();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                    删除供应商
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* 凭证配置 */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">凭证配置</h2>
          <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)]/30 p-5">
            <CredentialForm
              providerCode={provider.code}
              credential={defaultCredential}
            />
          </div>
        </section>

        {/* 连通性测试 */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)]/30 p-5">
            <ConnectionTest
              credentialId={defaultCredential?.id ?? null}
              models={models}
              defaultModelId="claude-haiku-4-5-20251001"
            />
          </div>
        </section>

        {/* 模型列表 */}
        <section className="space-y-4">
          <ModelList
            providerCode={provider.code}
            providerApiType={provider.api_type}
            models={models}
            credentialId={defaultCredential?.id ?? null}
            isLoading={modelsLoading}
            showDeployName={provider.api_type === 'azure'}
          />
        </section>
      </div>
    </motion.div>
  );
}
