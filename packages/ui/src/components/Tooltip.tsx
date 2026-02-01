import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  // 将 'position' 映射到 Radix 'side' 以保持向后兼容
  position?: 'top' | 'bottom' | 'left' | 'right';
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  delay?: number;
  contentClassName?: string;
  arrowClassName?: string;
}

export function Tooltip({ 
  content, 
  children, 
  position, 
  side, 
  align = 'center', 
  delay = 200,
  contentClassName,
  arrowClassName,
}: TooltipProps) {
  // 如果提供 'side' 则使用，否则回退到 'position'，默认为 'top'
  const finalSide = side || position || 'top';

  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={finalSide}
            align={align}
            sideOffset={5}
            className={cn(
              "z-[100] whitespace-nowrap rounded-full border border-[var(--border-default)] bg-[var(--bg-popover)] px-3 py-1 text-[10px] text-[var(--text-secondary)] shadow-sm animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
              contentClassName
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className={cn("fill-[var(--bg-popover)]", arrowClassName)} width={11} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
