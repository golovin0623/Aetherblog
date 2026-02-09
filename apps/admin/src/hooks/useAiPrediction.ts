/**
 * AI 实时预测 Hook
 *
 * 功能：
 * 1. 监听编辑器光标变化
 * 2. 防抖后调用 AI 预测服务
 * 3. 渲染 Ghost Text
 * 4. 处理快捷键接纳/拒绝
 */

import { useEffect, useRef, useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import {
  aiPredictionService,
  type AiPredictionContext,
} from '@/services/aiPredictionService';
import {
  setGhostText,
  clearGhostText,
  acceptGhostText,
  acceptGhostTextWord,
  acceptGhostTextLine,
} from '@/lib/ghost-text-extension';

interface UseAiPredictionOptions {
  enabled: boolean;              // 是否启用 AI 预测
  editorViewRef: React.RefObject<EditorView | null>;
  documentTitle?: string;
  writingStage?: string;
  debounceMs?: number;           // 防抖延迟（毫秒）
  minCharsToPredict?: number;    // 触发预测的最小字符数
  onPredictionAccepted?: (text: string) => void;
  onPredictionRejected?: () => void;
}

export function useAiPrediction({
  enabled,
  editorViewRef,
  documentTitle,
  writingStage,
  debounceMs = 800,
  minCharsToPredict = 10,
  onPredictionAccepted,
  onPredictionRejected,
}: UseAiPredictionOptions) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPredictionContextRef = useRef<string>('');
  const isPredictingRef = useRef(false);

  /**
   * 请求 AI 预测
   */
  const requestPrediction = useCallback(async (context: AiPredictionContext) => {
    const view = editorViewRef.current;
    if (!view) return;

    // 避免重复预测相同的上下文
    const contextKey = `${context.currentText}-${context.cursorPosition}`;
    if (contextKey === lastPredictionContextRef.current) {
      return;
    }

    // 检查最小字符数
    if (context.currentText.length < minCharsToPredict) {
      clearGhostText(view);
      return;
    }

    try {
      isPredictingRef.current = true;
      const result = await aiPredictionService.predict(context);

      // 检查是否还在同一位置（用户可能已经继续输入）
      const currentPos = view.state.selection.main.head;
      if (currentPos === context.cursorPosition) {
        // 置信度足够高时才显示建议
        if (result.confidence >= 0.6 && result.suggestion.trim()) {
          setGhostText(view, result.suggestion, result.confidence);
          lastPredictionContextRef.current = contextKey;
        }
      }
    } catch (error) {
      console.error('AI prediction failed:', error);
    } finally {
      isPredictingRef.current = false;
    }
  }, [editorViewRef, minCharsToPredict]);

  /**
   * 处理编辑器变化
   */
  const handleEditorChange = useCallback(() => {
    if (!enabled) return;

    const view = editorViewRef.current;
    if (!view) return;

    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 立即清除 Ghost Text（用户正在输入）
    clearGhostText(view);

    // 防抖后请求预测
    debounceTimerRef.current = setTimeout(() => {
      const cursorPos = view.state.selection.main.head;
      const currentText = view.state.doc.sliceString(0, cursorPos);

      const context: AiPredictionContext = {
        currentText,
        cursorPosition: cursorPos,
        documentTitle,
        writingStage,
      };

      requestPrediction(context);
    }, debounceMs);
  }, [enabled, editorViewRef, documentTitle, writingStage, debounceMs, requestPrediction]);

  /**
   * 接纳建议
   */
  const handleAccept = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    acceptGhostText(view);
    onPredictionAccepted?.('full');

    // 接纳后立即请求下一个预测
    setTimeout(() => {
      handleEditorChange();
    }, 100);
  }, [editorViewRef, onPredictionAccepted, handleEditorChange]);

  /**
   * 拒绝建议
   */
  const handleReject = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    clearGhostText(view);
    onPredictionRejected?.();
  }, [editorViewRef, onPredictionRejected]);

  /**
   * 接纳一个词
   */
  const handleAcceptWord = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    acceptGhostTextWord(view);
    onPredictionAccepted?.('word');
  }, [editorViewRef, onPredictionAccepted]);

  /**
   * 接纳一行
   */
  const handleAcceptLine = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    acceptGhostTextLine(view);
    onPredictionAccepted?.('line');
  }, [editorViewRef, onPredictionAccepted]);

  /**
   * 监听编辑器事件
   */
  useEffect(() => {
    if (!enabled) return;

    const view = editorViewRef.current;
    if (!view) return;

    // 监听文档变化
    const handleUpdate = () => {
      handleEditorChange();
    };

    const dom = view.dom;
    dom.addEventListener('input', handleUpdate);
    dom.addEventListener('keyup', handleUpdate);

    return () => {
      dom.removeEventListener('input', handleUpdate);
      dom.removeEventListener('keyup', handleUpdate);

      // 清理定时器
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // 清除 Ghost Text
      clearGhostText(view);
    };
  }, [enabled, editorViewRef, handleEditorChange]);

  /**
   * 清理缓存
   */
  const clearCache = useCallback(() => {
    aiPredictionService.clearCache();
  }, []);

  return {
    // 控制方法
    handleAccept,
    handleReject,
    handleAcceptWord,
    handleAcceptLine,
    clearCache,

    // 状态
    isPredicting: isPredictingRef.current,
  };
}
