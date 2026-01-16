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
}

export function Tooltip({ 
  content, 
  children, 
  position, 
  side, 
  align = 'center', 
  delay = 200 
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
              "z-[100] overflow-hidden rounded-md border border-white/10 bg-gray-900 px-3 py-1.5 text-xs text-white shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-gray-900" width={11} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
