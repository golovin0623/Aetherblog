// 供应商详情面板组件
// ref: §5.1 - AI Service 架构 (LobeChat 风格)

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ExternalLink,
  Pencil,
  XCircle,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Settings,
  Brain,
  Loader2,
} from 'lucide-react';
import { Tooltip } from '@aetherblog/ui';
import type { AiProvider } from '@/services/aiProviderService';
import { getPresetProvider, type PresetProvider } from '../types';
import { useToggleProvider, useDeleteProvider, useUpdateProvider } from '../hooks/useProviders';
import { useProviderCredentials, useCreateCredential, useRevealCredential } from '../hooks/useCredentials';
import { useProviderModels } from '../hooks/useModels';
import { getProviderBrand } from '../utils/brandColors';
import ProviderIcon from './ProviderIcon';
import ConnectionTest from './ConnectionTest';
import ModelList from './ModelList';

interface ProviderDetailProps {
  provider: AiProvider;
  onBack: () => void;
  onEdit: () => void;
  preset?: PresetProvider;
  activeTab: "config" | "models";
  onActiveTabChange: (tab: "config" | "models") => void;
}

const DUMMY_API_KEY_MASK = 'sk-****************************************';

export default function ProviderDetail({
  provider,
  onBack,
  onEdit,
  preset: propPreset,
  activeTab,
  onActiveTabChange: setActiveTab,
}: ProviderDetailProps) {
  const [showKey, setShowKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // Reset state when provider changes
  useEffect(() => {
    setShowKey(false);
    setRevealedKey(null);
  }, [provider.code]);

  // Computed
  const preset = propPreset || getPresetProvider(provider.code);
  // Allow user override from DB to take precedence over preset defaults
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

  // Data
  const { data: credentials = [] } = useProviderCredentials(provider.code);
  const defaultCredential = credentials.find((c) => c.is_default) || credentials[0];
  const { data: models = [], isLoading: modelsLoading } = useProviderModels(provider.code);

  // Mutations
  const toggleMutation = useToggleProvider();
  const deleteMutation = useDeleteProvider();
  const updateProviderMutation = useUpdateProvider();
  const createCredentialMutation = useCreateCredential();
  const revealMutation = useRevealCredential();

  // State for inline editing
  const [proxyInput, setProxyInput] = useState('');
  const [keyInput, setKeyInput] = useState('');

  // Sync state with props
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

  // Handle Save Proxy
  const handleSaveProxy = () => {
    if (proxyInput === (provider.base_url || '')) return; // No change

    updateProviderMutation.mutate({
      id: provider.id,
      data: { base_url: proxyInput || null } // Send null if empty to reset
    });
  };

  const handleSaveKey = () => {
    if (!keyInput || keyInput === DUMMY_API_KEY_MASK || keyInput === defaultCredential?.api_key_hint || keyInput === revealedKey) return; // No change

    createCredentialMutation.mutate({
      provider_code: provider.code,
      api_key: keyInput,
      is_default: true,
      name: 'Default Credential'
    }, {
      onSuccess: () => {
        setRevealedKey(null); // Clear revealed key after update
      }
    });
  };

  const handleRevealKey = async () => {
    if (!defaultCredential) return;

    if (showKey && revealedKey) {
      // If already showing, just toggle off
      setShowKey(false);
      return;
    }

    // Fetch the real key if not already fetched
    if (!revealedKey) {
      revealMutation.mutate(defaultCredential.id, {
        onSuccess: (data) => {
          setRevealedKey(data.api_key);
          setKeyInput(data.api_key);
          setShowKey(true);
        }
      });
    } else {
      // Already have the key, just toggle display
      setKeyInput(revealedKey);
      setShowKey(true);
    }
  };

  const handleToggle = (enabled: boolean) => {
    toggleMutation.mutate({ id: provider.id, enabled });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerSettings = (provider.capabilities?.settings || {}) as Record<string, any>;
  const showDeployName = provider.api_type === 'azure' || Boolean(providerSettings.showDeployName);
  const showChecker = providerSettings.showChecker !== false;
  const checkModel =
    (provider.capabilities?.checkModel as string | undefined) ||

    (provider.capabilities?.check_model as string | undefined);

  const handleDelete = () => {
    if (!confirm('确定删除该供应商吗？这将同时删除所有关联的模型和凭证。')) return;
    deleteMutation.mutate(provider.id, {
      onSuccess: () => onBack(),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex flex-col bg-[var(--bg-primary)] lg:bg-[var(--bg-secondary)] overflow-hidden"
    >
      {/* 头部区域 */}
      <div className="flex-none px-6 py-4 lg:px-8 bg-[var(--bg-primary)] border-b border-[var(--border-default)] z-20">
        <div className="flex items-start gap-4">
          {/* Logo */}
          <div
            className={`flex-none w-12 h-12 rounded-[14px] flex items-center justify-center shadow-md shrink-0 ${provider.is_enabled
              ? 'bg-white dark:bg-zinc-800'
              : 'bg-black/5 dark:bg-white/5 opacity-60 grayscale'
              }`}
            style={provider.is_enabled ? {
              boxShadow: `0 4px 12px -2px ${brand.primary}30`,
            } : undefined}
          >
            <ProviderIcon
              code={provider.code}
              icon={provider.icon}
              size={28}
              colorful={provider.is_enabled}
            />
          </div>

          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight truncate flex items-center gap-2">
                  {provider.display_name || provider.name}
                  <span className="px-2 py-0.5 rounded text-[10px] font-normal bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border-default)] font-mono">
                    {provider.code}
                  </span>
                </h1>
                {/* 链接 */}
                {docUrl && (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-primary transition-colors mt-1"
                  >
                    访问官网 <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* 编辑按钮 (Action Icon 风格) */}
                <Tooltip content="更新服务商基础配置" position="top" delay={0}>
                  <button
                    onClick={onEdit}
                    className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all shadow-sm"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </button>
                </Tooltip>

                {/* 启用/禁用开关 (LobeChat 风格 - 绝对定位修复) */}
                <button
                  onClick={() => handleToggle(!provider.is_enabled)}
                  disabled={toggleMutation.isPending}
                  className={`relative w-10 h-6 rounded-full p-0.5 transition-colors duration-200 ease-out focus:outline-none ${provider.is_enabled ? 'bg-black dark:bg-white' : 'bg-black/10 dark:bg-zinc-800'
                    }`}
                  title={provider.is_enabled ? "禁用服务商" : "启用服务商"}
                >
                  <motion.div
                    initial={false}
                    animate={{ x: provider.is_enabled ? 16 : 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className={`w-5 h-5 rounded-full shadow-sm ${provider.is_enabled ? 'bg-white dark:bg-black' : 'bg-white'
                      }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 移动端 Tab 切换器 */}
        <div className="mt-4 lg:hidden">
          <div className="relative flex p-1 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
            <button
              onClick={() => setActiveTab('config')}
              className={`relative flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-sm font-medium transition-all z-10 ${activeTab === 'config'
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
            >
              <Settings className="w-4 h-4" />
              配置
              {activeTab === 'config' && (
                <motion.div
                  layoutId="mobile-tab-bg"
                  className="absolute inset-0 bg-[var(--bg-primary)] rounded-lg shadow-sm border border-[var(--border-subtle)] -z-10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab('models')}
              className={`relative flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-sm font-medium transition-all z-10 ${activeTab === 'models'
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
            >
              <Brain className="w-4 h-4" />
              模型
              {activeTab === 'models' && (
                <motion.div
                  layoutId="mobile-tab-bg"
                  className="absolute inset-0 bg-[var(--bg-primary)] rounded-lg shadow-sm border border-[var(--border-subtle)] -z-10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 详情内容区域 */}
      <div
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-[var(--border-hover)] scrollbar-track-transparent relative z-0"
      >
        {/* 移动端: 使用 Tab 切换 */}
        <div className="lg:hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'config' ? (
              <motion.div
                key="config"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="px-6 py-6 space-y-4"
              >
                {/* 配置项列表容器 */}
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-default)] divide-y divide-[var(--border-default)]">

                  {/* 1. API Key Row (Input Style) */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4">
                    <div className="space-y-1 md:w-1/3">
                      <div className="font-medium text-sm text-[var(--text-primary)]">API Key</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        用于鉴权的 API Key
                      </div>
                    </div>
                    <div className="flex-1 max-w-lg relative">
                      <div className="relative group">
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
                          className="w-full px-3 py-2.5 pr-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/5 dark:focus:ring-white/10 transition-all placeholder:[var(--text-muted)]/40 shadow-sm"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <Tooltip content="点击获取并显示真实的 API Key" position="top" delay={0}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRevealKey(); }}
                              disabled={revealMutation.isPending}
                              className="p-1 hover:bg-[var(--bg-card-hover)] rounded text-[var(--text-muted)] transition-opacity disabled:opacity-50"
                              title={showKey ? "隐藏" : "显示真实密钥"}
                            >
                              {revealMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2. API Proxy Row (Input Style) */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4">
                    <div className="space-y-1 md:w-1/3">
                      <div className="font-medium text-sm text-[var(--text-primary)]">API 代理地址</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        接口请求的 Base URL
                      </div>
                    </div>
                    <div className="flex-1 max-w-lg">
                      <div className="relative group">
                        <input
                          type="text"
                          value={proxyInput}
                          onChange={(e) => setProxyInput(e.target.value)}
                          onBlur={handleSaveProxy}
                          placeholder={preset?.baseUrl || "默认地址"}
                          className="w-full px-3 py-2.5 pr-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/5 dark:focus:ring-white/10 transition-all placeholder:[var(--text-muted)]/40 shadow-sm"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 transition-opacity">
                          <Pencil className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. Connection Check Row */}
                  {showChecker && (
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4">
                      <div className="space-y-1 md:w-1/3">
                        <div className="font-medium text-sm text-[var(--text-primary)]">连通性检查</div>
                        <div className="text-xs text-[var(--text-muted)]">
                          测试 API Key 与代理地址是否正确
                        </div>
                      </div>
                      <div className="flex-1 max-w-lg">
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

                {/* 底部删除按钮 */}
                <div className="flex justify-center pt-2">
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-red-500/10 text-xs font-medium text-red-500 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    删除服务商配置
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="models"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
                className="px-6 py-6"
              >
                <ModelList
                  providerCode={provider.code}
                  providerApiType={provider.api_type}
                  providerCapabilities={provider.capabilities}
                  models={models}
                  credentialId={defaultCredential?.id ?? null}
                  isLoading={modelsLoading}
                  showDeployName={showDeployName}
                  variant="simple"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* PC 端: 同时显示配置和模型列表 */}
        <div className="hidden lg:block px-8 py-6 space-y-6">
          {/* 配置项列表容器 */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-default)] divide-y divide-[var(--border-default)]">

            {/* 1. API Key Row (Input Style) */}
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="space-y-1 w-1/3">
                <div className="font-medium text-sm text-[var(--text-primary)]">API Key</div>
                <div className="text-xs text-[var(--text-muted)]">
                  用于鉴权的 API Key
                </div>
              </div>
              <div className="flex-1 max-w-lg relative">
                <div className="relative group">
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
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/5 dark:focus:ring-white/10 transition-all placeholder:[var(--text-muted)]/40 shadow-sm"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <Tooltip content="点击获取并显示真实的 API Key" position="top" delay={0}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRevealKey(); }}
                        disabled={revealMutation.isPending}
                        className="p-1 hover:bg-[var(--bg-card-hover)] rounded text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                        title={showKey ? "隐藏" : "显示真实密钥"}
                      >
                        {revealMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. API Proxy Row (Input Style) */}
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="space-y-1 w-1/3">
                <div className="font-medium text-sm text-[var(--text-primary)]">API 代理地址</div>
                <div className="text-xs text-[var(--text-muted)]">
                  接口请求的 Base URL
                </div>
              </div>
              <div className="flex-1 max-w-lg">
                <div className="relative group">
                  <input
                    type="text"
                    value={proxyInput}
                    onChange={(e) => setProxyInput(e.target.value)}
                    onBlur={handleSaveProxy}
                    placeholder={preset?.baseUrl || "默认地址"}
                    className="w-full px-3 py-2.5 pr-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/5 dark:focus:ring-white/10 transition-all placeholder:[var(--text-muted)]/40 shadow-sm"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Pencil className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Connection Check Row */}
            {showChecker && (
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="space-y-1 w-1/3">
                  <div className="font-medium text-sm text-[var(--text-primary)]">连通性检查</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    测试 API Key 与代理地址是否正确
                  </div>
                </div>
                <div className="flex-1 max-w-lg">
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

          {/* PC 端模型列表 */}
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-default)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-4 h-4 text-[var(--text-muted)]" />
              <h3 className="font-medium text-sm text-[var(--text-primary)]">可用模型</h3>
            </div>
            <ModelList
              providerCode={provider.code}
              providerApiType={provider.api_type}
              providerCapabilities={provider.capabilities}
              models={models}
              credentialId={defaultCredential?.id ?? null}
              isLoading={modelsLoading}
              showDeployName={showDeployName}
              variant="simple"
            />
          </div>

          {/* 底部删除按钮 */}
          <div className="flex justify-center pt-2">
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-red-500/10 text-xs font-medium text-red-500 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              删除服务商配置
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
