// 连通性测试组件
// ref: §5.1 - AI Service 架构

import { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, Zap, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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

  const filteredModels = models.filter((m) => m.model_type === testMode && m.is_enabled);

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
    if (testMode === 'chat' && defaultModelId) {
      setSelectedModelId(defaultModelId);
      return;
    }
    if (selectedModelId && filteredModels.some((m) => m.model_id === selectedModelId)) {
      return;
    }
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
          <label className="text-sm text-[var(--text-muted)]">连通性检查</label>
          {/* 模式切换 */}
          <div className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-0.5">
            {([
              { key: 'chat' as const, label: '对话' },
              { key: 'embedding' as const, label: '向量化' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleModeChange(key)}
                className={`relative px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  testMode === key
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {testMode === key && (
                  <motion.span
                    layoutId="test-mode-indicator"
                    className="absolute inset-0 bg-[var(--bg-card-hover)] rounded-md"
                    transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
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
          <div className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-0.5 shrink-0">
            {([
              { key: 'chat' as const, label: '对话' },
              { key: 'embedding' as const, label: '向量化' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleModeChange(key)}
                className={`relative px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  testMode === key
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {testMode === key && (
                  <motion.span
                    layoutId="test-mode-indicator-simple"
                    className="absolute inset-0 bg-[var(--bg-card-hover)] rounded-md"
                    transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            ))}
          </div>
        )}

        {/* 自定义模型选择下拉框 */}
        <div className="relative flex-1" ref={dropdownRef}>
           <button
             onClick={() => setIsOpen(!isOpen)}
             className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] hover:border-primary/40 transition-colors"
           >
             <span className="truncate max-w-[180px]">{displayModelName}</span>
             <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] opacity-70 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
           </button>

           <AnimatePresence>
             {isOpen && (
               <motion.div
                 initial={{ opacity: 0, scale: 0.95, y: 5 }}
                 animate={{ opacity: 1, scale: 1, y: 0 }}
                 exit={{ opacity: 0, scale: 0.95, y: 5 }}
                 transition={{ duration: 0.1 }}
                 className="absolute top-full left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-popover)] shadow-lg py-1"
               >
                 {filteredModels.length > 0 ? (
                   filteredModels.map((model) => (
                     <button
                       key={model.id}
                       onClick={() => {
                         setSelectedModelId(model.model_id);
                         setIsOpen(false);
                       }}
                       className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[var(--bg-card-hover)] transition-colors"
                     >
                       <span className="truncate pr-2 text-[var(--text-primary)]">{model.display_name || model.model_id}</span>
                       {model.model_id === selectedModelId && (
                         <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                       )}
                     </button>
                   ))
                 ) : (
                   <div className="px-3 py-2 text-xs text-[var(--text-muted)] text-center">
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
          disabled={!credentialId || activeMutation.isPending}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm transition-all border ${
            credentialId
              ? 'bg-[var(--bg-primary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:text-primary hover:border-primary/30'
              : 'bg-[var(--bg-card)] border-[var(--border-default)] text-[var(--text-muted)] cursor-not-allowed'
          }`}
        >
          {activeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {testMode === 'chat' ? '检查' : '检查向量化'}
        </button>
      </div>

      {/* 测试结果 */}
      {result && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            result.success
              ? 'bg-status-success-light text-status-success'
              : 'bg-status-danger-light text-status-danger'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          <span className="flex-1 truncate">{result.message}</span>
          {result.success && result.latency_ms && (
            <span className="text-xs opacity-75 shrink-0">
              {result.latency_ms.toFixed(0)}ms
            </span>
          )}
        </div>
      )}

      {/* 提示信息 */}
      {!credentialId && (
        <p className="text-xs text-[var(--text-muted)] italic">
          请先保存 API Key 后再进行连通性测试
        </p>
      )}
    </div>
  );
}
