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
  const docUrl = preset?.docUrl || provider.doc_url || undefined;
  const description =
    (provider.capabilities?.description as string | undefined) || preset?.description;

  const toggleMutation = useToggleProvider();
  const deleteMutation = useDeleteProvider();
  const providerSettings = (provider.capabilities?.settings || {}) as Record<string, unknown>;
  const showDeployName =
    provider.api_type === 'azure' || Boolean(providerSettings.showDeployName);
  const showChecker = providerSettings.showChecker !== false;
  const checkModel =
    (provider.capabilities?.checkModel as string | undefined) ||
    (provider.capabilities?.check_model as string | undefined);

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
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <ProviderIcon code={provider.code} size={28} />
            <div>
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                {provider.display_name || provider.name}
              </h1>
              {description && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-xl">
                  {description}
                </p>
              )}
              {docUrl && (
                <a
                  href={docUrl}
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
                  : 'bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              <motion.div
                layout
                className={`absolute top-1 w-4 h-4 rounded-full transition-all ${
                  provider.is_enabled
                    ? 'left-7 bg-white'
                    : 'left-1 bg-[var(--text-muted)]/70'
                }`}
              />
            </button>
          </div>

          {/* 更多菜单 */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-xl hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-xl border border-[var(--border-default)] bg-[var(--bg-popover)] shadow-xl py-1">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onEdit();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
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
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-8">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* 凭证配置 */}
          <section className="space-y-4">
            <h2 className="text-sm font-medium text-[var(--text-secondary)]">凭证配置</h2>
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5">
              <CredentialForm
                providerCode={provider.code}
                credential={defaultCredential}
                providerCapabilities={provider.capabilities}
              />
            </div>
          </section>

          {/* 连通性测试 */}
          {showChecker && (
            <section className="space-y-4">
              <h2 className="text-sm font-medium text-[var(--text-secondary)]">连通性测试</h2>
              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5">
                <ConnectionTest
                  credentialId={defaultCredential?.id ?? null}
                  models={models}
                  defaultModelId={checkModel}
                />
              </div>
            </section>
          )}
        </div>

        {/* 模型列表 */}
        <section className="space-y-4">
          <ModelList
            providerCode={provider.code}
            providerApiType={provider.api_type}
            providerCapabilities={provider.capabilities}
            models={models}
            credentialId={defaultCredential?.id ?? null}
            isLoading={modelsLoading}
            showDeployName={showDeployName}
          />
        </section>
      </div>
    </motion.div>
  );
}
