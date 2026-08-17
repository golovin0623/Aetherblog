// 供应商详情面板组件 —— 接入配置 + 模型工作台
// ref: §5.1 - AI Service 架构 · 模型中心
// 设计: 品牌头部(logo 光晕 + mono 元数据行) · 配置 kv 面板(aiw-kv) · 危险区(aiw-danger)

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ExternalLink,
  Pencil,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Settings,
  Brain,
  Loader2,
  Trash2,
} from 'lucide-react';
import { Tooltip, Toggle, transition, variants } from '@aetherblog/ui';
import type { AiProvider } from '@/services/aiProviderService';
import { getPresetProvider, type PresetProvider } from '../types';
import { useToggleProvider, useDeleteProvider, useUpdateProvider } from '../hooks/useProviders';
import { useProviderCredentials, useCreateCredential, useRevealCredential } from '../hooks/useCredentials';
import { useProviderModels } from '../hooks/useModels';
import { getProviderBrand } from '../utils/brandColors';
import ProviderIcon from './ProviderIcon';
import ConnectionTest from './ConnectionTest';
import ModelList from './ModelList';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

interface ProviderDetailProps {
  provider: AiProvider;
  onBack: () => void;
  onEdit: () => void;
  preset?: PresetProvider;
  activeTab: "config" | "models";
  onActiveTabChange: (tab: "config" | "models") => void;
  initialModelSearch?: string;
}

const DUMMY_API_KEY_MASK = 'sk-****************************************';

export default function ProviderDetail({
  provider,
  onBack,
  onEdit,
  preset: propPreset,
  activeTab,
  onActiveTabChange: setActiveTab,
  initialModelSearch,
}: ProviderDetailProps) {
  const [showKey, setShowKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // 供应商切换时重置状态
  useEffect(() => {
    setShowKey(false);
    setRevealedKey(null);
  }, [provider.code]);

  // 计算属性
  const preset = propPreset || getPresetProvider(provider.code);
  // 优先使用数据库中的用户覆盖值，而非预设默认值
  const rawDocUrl = provider.doc_url || preset?.docUrl || undefined;

  // 安全验证：只允许 http:// 或 https:// 协议，防止 javascript: XSS 攻击
  const isSafeUrl = (url: string | undefined): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };
  const docUrl = isSafeUrl(rawDocUrl) ? rawDocUrl : undefined;

  const brand = getProviderBrand(provider.code);

  // 数据
  const { data: credentials = [] } = useProviderCredentials(provider.code);
  const defaultCredential = credentials.find((c) => c.is_default) || credentials[0];
  const { data: models = [], isLoading: modelsLoading } = useProviderModels(provider.code);

  const enabledModelCount = useMemo(
    () => models.filter((m) => m.is_enabled).length,
    [models]
  );

  // 数据变更操作
  const toggleMutation = useToggleProvider();
  const deleteMutation = useDeleteProvider();
  const updateProviderMutation = useUpdateProvider();
  const createCredentialMutation = useCreateCredential();
  const revealMutation = useRevealCredential();

  // 内联编辑状态
  const [proxyInput, setProxyInput] = useState('');
  const [keyInput, setKeyInput] = useState('');

  // 同步 props 到状态
  useEffect(() => {
    setProxyInput(provider.base_url || '');
  }, [provider.base_url]);

  useEffect(() => {
    if (defaultCredential) {
      setKeyInput(defaultCredential.api_key_hint || DUMMY_API_KEY_MASK);
    } else {
      setKeyInput('');
    }
  }, [defaultCredential]);

  // 保存代理地址
  const handleSaveProxy = () => {
    if (proxyInput === (provider.base_url || '')) return; // 无变化

    updateProviderMutation.mutate({
      id: provider.id,
      data: { base_url: proxyInput || null } // 为空时发送 null 以重置地址
    });
  };

  const handleSaveKey = () => {
    if (!keyInput || keyInput === DUMMY_API_KEY_MASK || keyInput === defaultCredential?.api_key_hint || keyInput === revealedKey) return; // 无变化

    createCredentialMutation.mutate({
      provider_code: provider.code,
      api_key: keyInput,
      is_default: true,
      name: 'Default Credential'
    }, {
      onSuccess: () => {
        setRevealedKey(null); // 更新成功后清除已获取的密钥
      }
    });
  };

  const handleRevealKey = async () => {
    if (!defaultCredential) return;

    if (showKey && revealedKey) {
      // 若已在显示状态，则直接切换隐藏
      setShowKey(false);
      return;
    }

    // 若尚未获取真实密钥，则请求获取
    if (!revealedKey) {
      revealMutation.mutate(defaultCredential.id, {
        onSuccess: (data) => {
          setRevealedKey(data.api_key);
          setKeyInput(data.api_key);
          setShowKey(true);
        }
      });
    } else {
      // 已有密钥，直接切换显示
      setKeyInput(revealedKey);
      setShowKey(true);
    }
  };

  const handleToggle = (enabled: boolean) => {
    toggleMutation.mutate({ id: provider.id, enabled });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 禁用 any 类型警告
  const providerSettings = (provider.capabilities?.settings || {}) as Record<string, any>;
  const showDeployName = provider.api_type === 'azure' || Boolean(providerSettings.showDeployName);
  const showChecker = providerSettings.showChecker !== false;
  const checkModel =
    (provider.capabilities?.checkModel as string | undefined) ||
    (provider.capabilities?.check_model as string | undefined);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(provider.id, {
      onSuccess: () => onBack(),
    });
  }, [deleteMutation, provider.id, onBack]);

  // 接入配置 kv 面板(移动端 tab 与桌面端共用)
  const configPanel = (
    <div className="aiw-kv-panel">
      {/* 1. API Key */}
      <div className="aiw-kv">
        <div className="aiw-kv-copy">
          <div className="aiw-kv-title">API Key</div>
          <div className="aiw-kv-desc">用于鉴权的密钥，失焦自动保存</div>
        </div>
        <div className="aiw-kv-control">
          <div className="group relative">
            <input
              type={showKey ? "text" : "password"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onBlur={handleSaveKey}
              onFocus={() => {
                if (keyInput === DUMMY_API_KEY_MASK || keyInput === defaultCredential?.api_key_hint) {
                  setKeyInput('');
                }
              }}
              placeholder={defaultCredential ? "点击修改 API Key" : "请输入 API Key"}
              data-mono="true"
              className="aiw-input pr-10"
              aria-label="API Key"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <Tooltip content="点击获取并显示真实的 API Key" position="top" delay={0}>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRevealKey(); }}
                  disabled={revealMutation.isPending}
                  className="rounded p-1 text-[var(--ink-muted)] transition-colors duration-quick ease-aether hover:bg-[var(--intelligence-control-hover)] hover:text-[var(--ink-primary)] disabled:opacity-50"
                  title={showKey ? "隐藏" : "显示真实密钥"}
                >
                  {revealMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : showKey ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {/* 2. API 代理地址 */}
      <div className="aiw-kv">
        <div className="aiw-kv-copy">
          <div className="aiw-kv-title">API 代理地址</div>
          <div className="aiw-kv-desc">接口请求的 Base URL，留空恢复默认</div>
        </div>
        <div className="aiw-kv-control">
          <div className="group relative">
            <input
              type="text"
              value={proxyInput}
              onChange={(e) => setProxyInput(e.target.value)}
              onBlur={handleSaveProxy}
              placeholder={preset?.baseUrl || "默认地址"}
              data-mono="true"
              className="aiw-input pr-8"
              aria-label="API 代理地址"
            />
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-quick ease-aether group-hover:opacity-100 group-focus-within:opacity-100">
              <Pencil className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
            </div>
          </div>
        </div>
      </div>

      {/* 3. 连通性检查 */}
      {showChecker && (
        <div className="aiw-kv">
          <div className="aiw-kv-copy">
            <div className="aiw-kv-title">连通性检查</div>
            <div className="aiw-kv-desc">验证 API Key 与代理地址是否可用</div>
          </div>
          <div className="aiw-kv-control">
            <ConnectionTest
              credentialId={defaultCredential?.id ?? null}
              models={models}
              defaultModelId={checkModel}
              simpleMode={true}
            />
          </div>
        </div>
      )}
    </div>
  );

  // 危险区
  const dangerZone = (
    <div className="aiw-danger">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--signal-danger)]">删除服务商配置</div>
        <div className="mt-0.5 text-micro text-[var(--ink-muted)]">
          将同时删除该服务商下的全部模型与凭证，且不可恢复。
        </div>
      </div>
      <button onClick={() => setShowDeleteConfirm(true)} className="aiw-button-danger">
        <Trash2 className="h-3.5 w-3.5" />
        删除
      </button>
    </div>
  );

  return (
    <motion.div
      variants={variants.fade}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition.quick}
      className="ai-provider-detail flex h-full flex-col overflow-hidden"
    >
      {/* 头部区域 */}
      <div className="ai-provider-detail-header z-20 flex-none border-b px-6 py-4 lg:px-8">
        <div className="flex items-start gap-4">
          {/* Logo:品牌色光晕 */}
          <div
            className={`flex h-12 w-12 flex-none shrink-0 items-center justify-center rounded-[14px] transition-all duration-quick ease-aether ${
              provider.is_enabled
                ? 'bg-[var(--bg-raised)]'
                : 'bg-[var(--intelligence-control)] opacity-60 grayscale'
            }`}
            style={provider.is_enabled ? {
              boxShadow: `0 4px 16px -2px ${brand.primary}38, inset 0 1px 0 rgb(from var(--bg-raised) r g b / 0.5)`,
            } : undefined}
          >
            <ProviderIcon
              code={provider.code}
              icon={provider.icon}
              size={28}
              colorful={provider.is_enabled}
            />
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 truncate text-lg font-bold tracking-tight text-[var(--ink-primary)]">
                  <span className="truncate">{provider.display_name || provider.name}</span>
                  <span className="aiw-signal-badge shrink-0" data-tone="neutral">
                    {provider.code}
                  </span>
                  <span
                    className="aiw-signal-badge shrink-0"
                    data-tone={provider.is_enabled ? 'success' : 'neutral'}
                  >
                    {provider.is_enabled ? '运行中' : '未启用'}
                  </span>
                </h1>
                {/* 元数据行:模型统计 + 凭证 + 官网 —— mono 秩序 */}
                <div className="aiw-model-meta mt-1.5">
                  <span>
                    模型 <b>{models.length}</b>
                  </span>
                  <span>
                    已启用 <b>{enabledModelCount}</b>
                  </span>
                  <span>凭证 <b>{defaultCredential ? '已配置' : '未配置'}</b></span>
                  {docUrl && (
                    <a
                      href={docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--ink-muted)] transition-colors duration-quick ease-aether hover:text-[var(--aurora-1)]"
                    >
                      访问官网 <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* 编辑按钮 (Action Icon 风格) */}
                <Tooltip content="更新服务商基础配置" position="top" delay={0}>
                  <button
                    onClick={onEdit}
                    className="aiw-tool-button !min-w-9 !px-0"
                    aria-label="更新服务商基础配置"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                </Tooltip>

                <Toggle
                  checked={provider.is_enabled}
                  onChange={(en) => handleToggle(en)}
                  disabled={toggleMutation.isPending}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 移动端 Tab 切换器 */}
        <div className="mt-4 lg:hidden">
          <div className="relative flex overflow-hidden rounded-xl border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-1">
            {([
              { key: 'config' as const, label: '配置', icon: Settings },
              { key: 'models' as const, label: '模型', icon: Brain },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-medium transition-colors duration-quick ease-aether ${
                  activeTab === key
                    ? 'text-[var(--ink-primary)]'
                    : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {activeTab === key && (
                  <motion.div
                    layoutId="mobile-tab-bg"
                    className="absolute inset-0 -z-10 rounded-lg border border-[var(--intelligence-border-strong)] bg-[var(--intelligence-panel-strong)]"
                    transition={transition.quick}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 详情内容区域 */}
      <div className="relative z-0 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-[var(--intelligence-border)] scrollbar-track-transparent">
        {/* 移动端: 使用 Tab 切换 */}
        <div className="lg:hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'config' ? (
              <motion.div
                key="config"
                variants={variants.slideRight}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={transition.quick}
                className="ai-provider-detail-mobile-section space-y-4 px-6 py-6"
              >
                {configPanel}
                {dangerZone}
              </motion.div>
            ) : (
              <motion.div
                key="models"
                variants={variants.slideRight}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={transition.quick}
                className="ai-provider-detail-mobile-section px-6 py-6"
              >
                <ModelList
                  providerCode={provider.code}
                  providerApiType={provider.api_type}
                  providerCapabilities={provider.capabilities}
                  models={models}
                  credentialId={defaultCredential?.id ?? null}
                  isLoading={modelsLoading}
                  showDeployName={showDeployName}
                  initialSearch={initialModelSearch}
                  variant="simple"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* PC 端: 同时显示配置和模型列表 */}
        <div className="ai-provider-detail-content hidden space-y-6 px-8 py-6 lg:block">
          <section className="space-y-3">
            <div className="aiw-eyebrow">接入配置</div>
            {configPanel}
          </section>

          <section className="ai-provider-model-panel rounded-xl border p-4">
            <ModelList
              providerCode={provider.code}
              providerApiType={provider.api_type}
              providerCapabilities={provider.capabilities}
              models={models}
              credentialId={defaultCredential?.id ?? null}
              isLoading={modelsLoading}
              showDeployName={showDeployName}
              initialSearch={initialModelSearch}
              variant="simple"
            />
          </section>

          {dangerZone}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="删除供应商"
        message="确定删除该供应商吗？这将同时删除所有关联的模型和凭证。"
        confirmText="删除"
        variant="danger"
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete(); }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </motion.div>
  );
}
