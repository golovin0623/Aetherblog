// 连通性测试组件
// ref: §5.1 - AI Service 架构

import { useEffect, useMemo, useState, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, Zap, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { spring, transition } from '@aetherblog/ui';
import type { AiModel } from '@/services/aiProviderService';
import { useTestCredential, useTestEmbeddingCredential } from '../hooks/useCredentials';
import type { ConnectionTestResult } from '../types';

type TestMode = 'chat' | 'embedding';

interface ConnectionTestProps {
  credentialId: number | null;
  models: AiModel[];
  defaultModelId?: string;
  simpleMode?: boolean;
  providerCode?: string;
}

export default function ConnectionTest({
  credentialId,
  models,
  defaultModelId,
  simpleMode = false,
}: ConnectionTestProps) {
  const [testMode, setTestMode] = useState<TestMode>('chat');
  const [selectedModelId, setSelectedModelId] = useState(
    defaultModelId || models.find((m) => m.model_type === 'chat')?.model_id || ''
  );
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const chatTestMutation = useTestCredential();
  const embeddingTestMutation = useTestEmbeddingCredential();
  const activeMutation = testMode === 'chat' ? chatTestMutation : embeddingTestMutation;

  const filteredModels = useMemo(
    () => models.filter((m) => m.model_type === testMode && m.is_enabled),
    [models, testMode]
  );

  // 点击外部时关闭下拉框
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 切换模式或模型列表变化时，重选默认模型
  useEffect(() => {
    // 切换供应商/模式时清除上次测试结果
    setResult(null);

    if (testMode === 'chat' && defaultModelId) {
      setSelectedModelId(defaultModelId);
      return;
    }
    // 当前选中的模型仍在列表中，无需切换
    if (selectedModelId && filteredModels.some((m) => m.model_id === selectedModelId)) {
      return;
    }
    // 选择列表中第一个可用模型，或清空
    setSelectedModelId(filteredModels[0]?.model_id || '');
  }, [testMode, defaultModelId, filteredModels, selectedModelId]);

  // 切换模式时清除上次结果
  const handleModeChange = (mode: TestMode) => {
    if (mode === testMode) return;
    setTestMode(mode);
    setResult(null);
  };

  const handleTest = () => {
    if (!credentialId) return;
    setResult(null);
    activeMutation.mutate(
      { credentialId, modelId: selectedModelId },
      {
        onSuccess: (res) => setResult(res),
      }
    );
  };

  const currentModel = filteredModels.find(m => m.model_id === selectedModelId);
  const displayModelName = currentModel?.display_name || selectedModelId || '选择测试模型';
  const emptyModelHint = testMode === 'chat' ? '无可用对话模型' : '无可用向量化模型';

  return (
    <div className="space-y-3">
      {!simpleMode && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-[var(--ink-muted)]">连通性检查</label>
          {/* 模式切换 */}
          <div className="inline-flex rounded-lg border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-0.5">
            {([
              { key: 'chat' as const, label: '对话' },
              { key: 'embedding' as const, label: '向量化' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleModeChange(key)}
                className={`relative px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  testMode === key
                    ? 'text-[var(--ink-primary)]'
                    : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
                }`}
              >
                {testMode === key && (
                  <motion.span
                    layoutId="test-mode-indicator"
                    className="absolute inset-0 rounded-md border border-[var(--intelligence-border)] bg-[var(--intelligence-panel-strong)]"
                    transition={spring.precise}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* simpleMode 下内联模式切换 */}
        {simpleMode && (
          <div className="inline-flex rounded-lg border border-[var(--intelligence-border)] bg-[var(--intelligence-control)] p-0.5 shrink-0">
            {([
              { key: 'chat' as const, label: '对话' },
              { key: 'embedding' as const, label: '向量化' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleModeChange(key)}
                className={`relative px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  testMode === key
                    ? 'text-[var(--ink-primary)]'
                    : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
                }`}
              >
                {testMode === key && (
                  <motion.span
                    layoutId="test-mode-indicator-simple"
                    className="absolute inset-0 rounded-md border border-[var(--intelligence-border)] bg-[var(--intelligence-panel-strong)]"
                    transition={spring.precise}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            ))}
          </div>
        )}

        {/* 自定义模型选择下拉框 */}
        <div className="relative flex-1 min-w-0" ref={dropdownRef}>
           <button
             onClick={() => setIsOpen(!isOpen)}
             className="aiw-input flex w-full items-center justify-between gap-1 !py-2 text-sm"
           >
             <span className="truncate min-w-0 flex-1 text-left">{displayModelName}</span>
             <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--ink-muted)] opacity-70 transition-transform duration-quick ease-aether ${isOpen ? 'rotate-180' : ''}`} />
           </button>

           <AnimatePresence>
             {isOpen && (
               <motion.div
                 initial={{ opacity: 0, scale: 0.95, y: 5 }}
                 animate={{ opacity: 1, scale: 1, y: 0 }}
                 exit={{ opacity: 0, scale: 0.95, y: 5 }}
                 transition={transition.quick}
                 className="surface-raised absolute top-full left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto !rounded-lg py-1"
               >
                 {filteredModels.length > 0 ? (
                   filteredModels.map((model) => (
                     <button
                       key={model.id}
                       onClick={() => {
                         setSelectedModelId(model.model_id);
                         setIsOpen(false);
                       }}
                       className="w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors duration-quick ease-aether hover:bg-[var(--intelligence-control-hover)]"
                     >
                       <span className="truncate pr-2 text-[var(--ink-primary)]">{model.display_name || model.model_id}</span>
                       {model.model_id === selectedModelId && (
                         <Check className="w-3.5 h-3.5 text-[var(--aurora-1)] flex-shrink-0" />
                       )}
                     </button>
                   ))
                 ) : (
                   <div className="px-3 py-2 text-xs text-[var(--ink-muted)] text-center">
                     {emptyModelHint}
                   </div>
                 )}
               </motion.div>
             )}
           </AnimatePresence>
        </div>

        {/* 测试按钮 */}
        <button
          onClick={handleTest}
          disabled={!credentialId || !selectedModelId || activeMutation.isPending}
          className="aiw-tool-button shrink-0 !min-h-[2.4rem]"
        >
          {activeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          检查
        </button>
      </div>

      {/* 测试结果 */}
      {result && (
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{
            color: result.success ? 'var(--signal-success)' : 'var(--signal-danger)',
            borderColor: `color-mix(in oklch, ${result.success ? 'var(--signal-success)' : 'var(--signal-danger)'} 26%, transparent)`,
            background: `color-mix(in oklch, ${result.success ? 'var(--signal-success)' : 'var(--signal-danger)'} 8%, transparent)`,
          }}
        >
          {result.success ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          <span className="flex-1 truncate">{result.message}</span>
          {result.success && result.latency_ms && (
            <span className="font-mono text-xs tnum opacity-75 shrink-0">
              {result.latency_ms.toFixed(0)}ms
            </span>
          )}
        </div>
      )}

      {/* 提示信息 */}
      {!credentialId && (
        <p className="text-xs text-[var(--ink-muted)]">
          请先保存 API Key 后再进行连通性测试
        </p>
      )}
    </div>
  );
}
