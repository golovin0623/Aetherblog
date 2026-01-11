/**
 * @file useImageUpload.ts
 * @description Hook for handling image upload with progress tracking in the editor
 */

import { useState, useCallback, useRef } from 'react';
import type { UploadItem } from './components/UploadProgress';

/**上传结果 */
export interface UploadResult {
  url: string;
  originalName: string;
  width?: number;
  height?: number;
}

/** 上传函数类型 */
export type UploadFunction = (
  file: File,
  onProgress?: (percent: number) => void
) => Promise<UploadResult>;

export interface UseImageUploadOptions {
  /** 上传函数 */
  uploadFn: UploadFunction;
  /** 允许的文件类型 */
  acceptTypes?: string[];
  /** 最大文件大小 (bytes) */
  maxSize?: number;
  /** 上传成功后的回调 */
  onUploadComplete?: (result: UploadResult, file: File) => void;
  /** 上传失败的回调 */
  onUploadError?: (error: Error, file: File) => void;
}

export interface UseImageUploadReturn {
  /** 当前上传列表 */
  uploads: UploadItem[];
  /** 是否有文件正在上传 */
  isUploading: boolean;
  /** 上传文件 */
  uploadFiles: (files: File[]) => Promise<UploadResult[]>;
  /** 处理拖拽事件 */
  handleDrop: (e: React.DragEvent) => void;
  /** 处理拖拽进入*/
  handleDragOver: (e: React.DragEvent) => void;
  /** 处理拖拽离开 */
  handleDragLeave: (e: React.DragEvent) => void;
  /** 处理粘贴事件 */
  handlePaste: (e: React.ClipboardEvent) => void;
  /** 是否正在拖拽 */
  isDragging: boolean;
  /** 移除上传项 */
  removeUpload: (id: string) => void;
  /** 重试上传 */
  retryUpload: (id: string) => void;
  /** 清除所有完成的上传 */
  clearCompleted: () => void;
}

// 默认允许的图片类型
const DEFAULT_ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

// 默认最大大小:20MB
const DEFAULT_MAX_SIZE = 20 * 1024 * 1024;

/**
 * 图片上传 Hook
 * 提供拖拽、粘贴、进度追踪等功能
 */
export function useImageUpload({
  uploadFn,
  acceptTypes = DEFAULT_ACCEPT_TYPES,
  maxSize = DEFAULT_MAX_SIZE,
  onUploadComplete,
  onUploadError,
}: UseImageUploadOptions): UseImageUploadReturn {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileQueueRef = useRef<Map<string, File>>(new Map());

  /**
   * 生成唯一 ID
   */
  const generateId = () => `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  /**
   * 验证文件
   */
  const validateFile = useCallback((file: File): { valid: boolean; error?: string } => {
    if (!acceptTypes.includes(file.type)) {
      return { valid: false, error: `不支持的文件类型: ${file.type}` };
    }
    if (file.size > maxSize) {
      return { valid: false, error: `文件过大: ${(file.size / 1024 / 1024).toFixed(2)}MB，最大 ${(maxSize / 1024 / 1024).toFixed(0)}MB` };
    }
    return { valid: true };
  }, [acceptTypes, maxSize]);

  /**
   * 上传单个文件
   */
  const uploadSingleFile = useCallback(async (id: string, file: File): Promise<UploadResult | null> => {
    try {
      const result = await uploadFn(file, (percent) => {
        setUploads(prev => prev.map(item =>
          item.id === id ? { ...item, progress: percent } : item
        ));
      });

      setUploads(prev => prev.map(item =>
        item.id === id ? { ...item, status: 'success', progress: 100, url: result.url } : item
      ));

      onUploadComplete?.(result, file);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传失败';
      setUploads(prev => prev.map(item =>
        item.id === id ? { ...item, status: 'error', error: errorMessage } : item
      ));
      onUploadError?.(error instanceof Error ? error : new Error(errorMessage), file);
      return null;
    }
  }, [uploadFn, onUploadComplete, onUploadError]);

  /**
   * 上传多个文件
   */
  const uploadFiles = useCallback(async (files: File[]): Promise<UploadResult[]> => {
    const validFiles: Array<{ id: string; file: File }> = [];

    for (const file of files) {
      const validation = validateFile(file);
      const id = generateId();

      if (validation.valid) {
        validFiles.push({ id, file });
        fileQueueRef.current.set(id, file);
        setUploads(prev => [...prev, {
          id,
          file,
          progress: 0,
          status: 'uploading',
        }]);
      } else {
        // 直接添加为错误状态
        setUploads(prev => [...prev, {
          id,
          file,
          progress: 0,
          status: 'error',
          error: validation.error,
        }]);
      }
    }

    // 并行上传
    const results = await Promise.all(
      validFiles.map(({ id, file }) => uploadSingleFile(id, file))
    );

    return results.filter((r): r is UploadResult => r !== null);
  }, [validateFile, uploadSingleFile]);

  /**
   * 处理拖拽悬停 - 必须调用 preventDefault 才能触发 drop 事件
   * 同时处理拖拽进入逻辑（带计数器防止闪烁）
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 首次进入时设置拖拽状态
    if (dragCounterRef.current === 0 && e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
    dragCounterRef.current = Math.max(1, dragCounterRef.current);
  }, []);

  /**
   * 处理拖拽离开
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  /**
   * 处理拖放
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );

    if (files.length > 0) {
      uploadFiles(files);
    }
  }, [uploadFiles]);

  /**
   * 处理粘贴
   */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
  }, [uploadFiles]);

  /**
   * 移除上传项
   */
  const removeUpload = useCallback((id: string) => {
    setUploads(prev => prev.filter(item => item.id !== id));
    fileQueueRef.current.delete(id);
  }, []);

  /**
   * 重试上传
   */
  const retryUpload = useCallback((id: string) => {
    const file = fileQueueRef.current.get(id);
    if (!file) return;

    setUploads(prev => prev.map(item =>
      item.id === id ? { ...item, status: 'uploading', progress: 0, error: undefined } : item
    ));

    uploadSingleFile(id, file);
  }, [uploadSingleFile]);

  /**
   * 清除已完成的上传
   */
  const clearCompleted = useCallback(() => {
    setUploads(prev => prev.filter(item => item.status === 'uploading'));
    // 清理文件引用
    for (const [id, _] of fileQueueRef.current) {
      const upload = uploads.find(u => u.id === id);
      if (upload && upload.status !== 'uploading') {
        fileQueueRef.current.delete(id);
      }
    }
  }, [uploads]);

  const isUploading = uploads.some(u => u.status === 'uploading');

  return {
    uploads,
    isUploading,
    uploadFiles,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handlePaste,
    isDragging,
    removeUpload,
    retryUpload,
    clearCompleted,
  };
}