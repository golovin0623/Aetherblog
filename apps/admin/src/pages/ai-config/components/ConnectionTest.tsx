// 连通性测试组件
// ref: §5.1 - AI Service 架构

import { useEffect, useState, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, Zap, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AiModel } from '@/services/aiProviderService';
import { useTestCredential } from '../hooks/useCredentials';
import type { ConnectionTestResult } from '../types';

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
  const [selectedModelId, setSelectedModelId] = useState(
    defaultModelId || models.find((m) => m.model_type === 'chat')?.model_id || ''
  );
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const testMutation = useTestCredential();
  const chatModels = models.filter((m) => m.model_type === 'chat' && m.is_enabled);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (defaultModelId) {
      setSelectedModelId(defaultModelId);
      return;
    }
    if (selectedModelId && chatModels.some((m) => m.model_id === selectedModelId)) {
      return;
    }
    setSelectedModelId(chatModels[0]?.model_id || '');
  }, [defaultModelId, chatModels, selectedModelId]);

  const handleTest = () => {
    if (!credentialId) return;
    setResult(null);
    testMutation.mutate(
      { credentialId, modelId: selectedModelId },
      {
        onSuccess: (res) => setResult(res),
      }
    );
  };
  
  const currentModel = chatModels.find(m => m.model_id === selectedModelId);
  const displayModelName = currentModel?.display_name || selectedModelId || '选择测试模型';

  return (
    <div className="space-y-3">
      {!simpleMode && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-[var(--text-muted)]">连通性检查</label>
        </div>
      )}

      <div className="flex items-center gap-2">
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
                 {chatModels.length > 0 ? (
                   chatModels.map((model) => (
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
                     无可用聊天模型
                   </div>
                 )}
               </motion.div>
             )}
           </AnimatePresence>
        </div>

        {/* 测试按钮 */}
        <button
          onClick={handleTest}
          disabled={!credentialId || testMutation.isPending}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm transition-all border ${
            credentialId
              ? 'bg-[var(--bg-primary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:text-primary hover:border-primary/30'
              : 'bg-[var(--bg-card)] border-[var(--border-default)] text-[var(--text-muted)] cursor-not-allowed'
          }`}
        >
          {testMutation.isPending ? (
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
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            result.success
              ? 'bg-emerald-500/10 text-emerald-500'
              : 'bg-red-500/10 text-red-500'
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
