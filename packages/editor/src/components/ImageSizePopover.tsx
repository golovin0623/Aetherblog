import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';

export interface ImageSizePopoverProps {
  /** 当前图片的 Markdown 位置信息 */
  imageInfo: {
    from: number;
    to: number;
    url: string;
    alt: string;
    currentSize?: string; // 当前大小如 "50%" 或 "200px"
  };
  /**锚点位置（相对于视口） */
  anchorPosition: { x: number; y: number };
  /** 确认选择 */
  onSelect: (size: string | null) => void;
  /** 关闭弹窗 */
  onClose: () => void;
}

/** 预设大小选项 */
const SIZE_PRESETS = [
  { label: '原始', value: null },
  { label: '20%', value: '20%' },
  { label: '30%', value: '30%' },
  { label: '40%', value: '40%' },
  { label: '50%', value: '50%' },
  { label: '60%', value: '60%' },
  { label: '70%', value: '70%' },
  { label: '80%', value: '80%' },
  { label: '90%', value: '90%' },
  { label: '100%', value: '100%' },
];

/**
 * 图片大小选择弹窗组件
 * 允许用户选择预设大小或输入自定义尺寸
 */
export function ImageSizePopover({
  imageInfo,
  anchorPosition,
  onSelect,
  onClose,
}: ImageSizePopoverProps) {
  const [customSize, setCustomSize] = useState(imageInfo.currentSize || '');
  const popoverRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // 计算弹窗位置，确保不超出视口
  const getPopoverStyle = (): React.CSSProperties => {
    const popoverWidth = 200;
    const popoverHeight = 320;
    
    let left = anchorPosition.x - popoverWidth / 2;
    let top = anchorPosition.y + 10;

    // 确保不超出右边界
    if (left + popoverWidth > window.innerWidth - 10) {
      left = window.innerWidth - popoverWidth - 10;
    }
    // 确保不超出左边界
    if (left < 10) {
      left = 10;
    }
    // 如果下方空间不足，显示在上方
    if (top + popoverHeight > window.innerHeight - 10) {
      top = anchorPosition.y - popoverHeight - 10;
    }

    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 9999,
    };
  };

  const handlePresetSelect = (value: string | null) => {
    onSelect(value);
  };

  const handleCustomConfirm = () => {
    if (customSize.trim()) {
      // 自动添加 % 或 px 后缀
      let finalSize = customSize.trim();
      if(/^\d+$/.test(finalSize)) {
        finalSize += '%'; // 纯数字默认添加 %
      }
      onSelect(finalSize);
    }
  };

  return (
    <div
      ref={popoverRef}
      style={getPopoverStyle()}
      className="w-48 bg-[#1e1e20] border border-white/10 rounded-lg shadow-2xl overflow-hidden"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/5">
        <span className="text-xs font-medium text-gray-300">图片大小</span>
        <button
          onClick={onClose}
          className="p-0.5 text-gray-500 hover:text-white transition-colors rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 预设选项 */}
      <div className="p-2 max-h-48 overflow-y-auto">
        <div className="grid grid-cols-2 gap-1">
          {SIZE_PRESETS.map((preset) => {
            const isSelected = imageInfo.currentSize === preset.value ||
              (!imageInfo.currentSize && preset.value === null);
            return (
              <button
                key={preset.label}
                onClick={() => handlePresetSelect(preset.value)}
                className={`
                  px-2 py-1.5 text-xs rounded transition-colors flex items-center justify-center gap-1
                  ${isSelected
                    ? 'bg-primary text-white'
                    : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }
                `}
              >
                {preset.label}
                {isSelected && <Check className="w-3 h-3" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 自定义尺寸 */}
      <div className="px-2 pb-2 border-t border-white/5 pt-2">
        <label className="text-[10px] text-gray-500 mb-1 block">自定义尺寸</label>
        <div className="flex gap-1">
          <input
            type="text"
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            placeholder="如: 300px 或 75%"
            className="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-white placeholder-gray-600 focus:outline-none focus:border-primary/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCustomConfirm();
              }
            }}
          />
          <button
            onClick={handleCustomConfirm}
            className="px-2 py-1 text-xs bg-primary hover:bg-primary/90 text-white rounded transition-colors"
          >
            <Check className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}