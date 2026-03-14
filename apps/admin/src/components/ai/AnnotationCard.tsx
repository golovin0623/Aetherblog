/**
 * 批注系统组件
 *
 * 功能：
 * 1. 在编辑器中高亮显示 AI 建议位置
 * 2. 显示批注卡片（建议内容、原因、操作）
 * 3. 支持接受/拒绝/修改建议
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  X,
  Edit3,
  Sparkles,
  AlertCircle,
  Info,
  ChevronDown,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Annotation } from '@/types/writing-workflow';

interface AnnotationCardProps {
  annotation: Annotation;
  onAccept: () => void;
  onReject: () => void;
  onEdit: (newSuggestion: string) => void;
  style?: React.CSSProperties;
}

export function AnnotationCard({
  annotation,
  onAccept,
  onReject,
  onEdit,
  style,
}: AnnotationCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSuggestion, setEditedSuggestion] = useState(annotation.suggestion || '');
  const [isExpanded, setIsExpanded] = useState(true);

  const handleSave = () => {
    onEdit(editedSuggestion);
    setIsEditing(false);
  };

  const severityConfig = {
    info: {
      icon: Info,
      bgColor: 'bg-status-info-light',
      borderColor: 'border-status-info-border',
      textColor: 'text-status-info',
    },
    warning: {
      icon: AlertCircle,
      bgColor: 'bg-status-warning-light',
      borderColor: 'border-status-warning-border',
      textColor: 'text-status-warning',
    },
    error: {
      icon: AlertCircle,
      bgColor: 'bg-status-danger-light',
      borderColor: 'border-status-danger-border',
      textColor: 'text-status-danger',
    },
  };

  const typeConfig = {
    suggestion: { label: 'AI 建议', icon: Sparkles, color: 'text-accent' },
    grammar: { label: '语法', icon: AlertCircle, color: 'text-status-danger' },
    style: { label: '风格', icon: Lightbulb, color: 'text-status-info' },
    'fact-check': { label: '事实核查', icon: AlertCircle, color: 'text-status-warning' },
  };

  const config = severityConfig[annotation.severity];
  const typeInfo = typeConfig[annotation.type];
  const Icon = typeInfo.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      style={style}
      className={cn(
        'absolute z-50 w-80 rounded-xl border shadow-2xl backdrop-blur-xl',
        config.bgColor,
        config.borderColor,
        'overflow-hidden'
      )}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/80">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', typeInfo.color)} />
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {typeInfo.label}
          </span>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 rounded-md hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)]"
        >
          <ChevronDown
            className={cn(
              'w-4 h-4 transition-transform',
              !isExpanded && '-rotate-90'
            )}
          />
        </button>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {/* 内容 */}
            <div className="px-4 py-3 space-y-3">
              {/* 消息 */}
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">问题</p>
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  {annotation.message}
                </p>
              </div>

              {/* 建议 */}
              {annotation.suggestion && (
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-1">建议修改</p>
                  {isEditing ? (
                    <textarea
                      value={editedSuggestion}
                      onChange={(e) => setEditedSuggestion(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:border-primary/50 resize-none"
                      rows={3}
                      autoFocus
                    />
                  ) : (
                    <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)]/70 border border-[var(--border-subtle)]">
                      <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                        {annotation.suggestion}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="px-4 py-3 bg-[var(--bg-secondary)]/50 border-t border-[var(--border-subtle)] flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleSave}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90"
                  >
                    <Check className="w-4 h-4" />
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setEditedSuggestion(annotation.suggestion || '');
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-card-hover)] text-[var(--text-secondary)] text-sm hover:bg-[var(--bg-tertiary)]"
                  >
                    <X className="w-4 h-4" />
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={onAccept}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-status-success text-white text-sm hover:bg-status-success"
                  >
                    <Check className="w-4 h-4" />
                    接受
                  </button>
                  {annotation.suggestion && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-muted)] text-sm hover:bg-[var(--bg-card-hover)]"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={onReject}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-muted)] text-sm hover:bg-status-danger-light hover:text-status-danger"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ==================== 批注列表组件 ====================

interface AnnotationListProps {
  annotations: Annotation[];
  onAnnotationClick: (annotation: Annotation) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function AnnotationList({
  annotations,
  onAnnotationClick,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: AnnotationListProps) {
  const pendingAnnotations = annotations.filter(a => !a.accepted);
  const acceptedAnnotations = annotations.filter(a => a.accepted);

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            AI 批注 ({pendingAnnotations.length})
          </h3>
          {pendingAnnotations.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={onAcceptAll}
                className="px-2 py-1 text-xs rounded-md bg-status-success text-white hover:bg-status-success"
              >
                全部接受
              </button>
              <button
                onClick={onRejectAll}
                className="px-2 py-1 text-xs rounded-md bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:bg-status-danger-light hover:text-status-danger"
              >
                全部拒绝
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
          <span>待处理: {pendingAnnotations.length}</span>
          <span>已接受: {acceptedAnnotations.length}</span>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {pendingAnnotations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <Sparkles className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">暂无批注</p>
          </div>
        ) : (
          pendingAnnotations.map(annotation => (
            <AnnotationListItem
              key={annotation.id}
              annotation={annotation}
              onClick={() => onAnnotationClick(annotation)}
              onAccept={() => onAccept(annotation.id)}
              onReject={() => onReject(annotation.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ==================== 批注列表项 ====================

interface AnnotationListItemProps {
  annotation: Annotation;
  onClick: () => void;
  onAccept: () => void;
  onReject: () => void;
}

function AnnotationListItem({
  annotation,
  onClick,
  onAccept,
  onReject,
}: AnnotationListItemProps) {
  const severityColors = {
    info: 'bg-status-info-light border-status-info-border text-status-info',
    warning: 'bg-status-warning-light border-status-warning-border text-status-warning',
    error: 'bg-status-danger-light border-status-danger-border text-status-danger',
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full p-3 rounded-lg border transition-all text-left group',
        'hover:bg-[var(--bg-card-hover)] hover:border-primary/30',
        'bg-[var(--bg-secondary)]/50 border-[var(--border-subtle)]'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-xs font-medium',
              severityColors[annotation.severity]
            )}
          >
            {annotation.type}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccept();
            }}
            className="p-1 rounded hover:bg-status-success-light text-status-success"
            title="接受"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
            className="p-1 rounded hover:bg-status-danger-light text-status-danger"
            title="拒绝"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <p className="text-sm text-[var(--text-primary)] line-clamp-2">
        {annotation.message}
      </p>
      {annotation.suggestion && (
        <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-1">
          建议: {annotation.suggestion}
        </p>
      )}
    </button>
  );
}
