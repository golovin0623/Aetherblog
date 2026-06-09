import { useEffect, useRef, useState } from 'react';

/**
 * useSmoothStream —— 把模型 SSE 的"突发式 delta"平滑成"匀速吐字"
 *
 * 平滑流式渲染设计：
 *   1. 真正的 token 流速度是抖的（有时 80 tok/s 一爆，有时停顿 500ms）；
 *   2. 直接渲染会让 UI 一卡一卡，阅读节奏被打散；
 *   3. 改用一个内部缓冲 + 节流释放：每帧按目标 chars/s 速率把 buffer 里的字符
 *      喂到 shown 上，让 UI 看起来是匀速 typewriter。
 *
 * 三档模式：
 *   - 'none'   ：无平滑，shown ≡ rawContent（=原始行为，最快）
 *   - 'fade'   ：~80 chars/s 节流 + 内容容器叠 opacity transition（轻盈）
 *   - 'smooth' ：~45 chars/s 节流（更"思考"的体感，对应 LobeHub 默认）
 *
 * 退出条件：
 *   - pending 翻成 false（流结束）→ 立即把 shown 同步到完整 rawContent，
 *     不让用户等动画追平；
 *   - mode 变 'none' → 同上立即同步。
 */
export type StreamAnimationMode = 'none' | 'fade' | 'smooth';

const RATE_BY_MODE: Record<StreamAnimationMode, number> = {
  none: Infinity,
  fade: 80,
  smooth: 45,
};

export function useSmoothStream(
  rawContent: string,
  pending: boolean,
  mode: StreamAnimationMode,
): string {
  const [shown, setShown] = useState(rawContent);
  const targetRef = useRef(rawContent);

  useEffect(() => {
    targetRef.current = rawContent;

    // 完成态 / 'none' 模式 → 立即对齐
    if (!pending || mode === 'none') {
      setShown(rawContent);
      return;
    }

    let raf = 0;
    let lastTick = performance.now();
    const charsPerMs = RATE_BY_MODE[mode] / 1000;

    const tick = (now: number) => {
      const dt = now - lastTick;
      lastTick = now;
      const target = targetRef.current;

      setShown((cur) => {
        if (cur === target) return cur;
        if (cur.length >= target.length) return target;
        // dt（毫秒）× charsPerMs = 该帧应释放的字符数；至少 1 个，避免 60Hz
        // 下出现"该帧没字符"导致光标空闪
        const charsToAdd = Math.max(1, Math.round(dt * charsPerMs));
        const nextLen = Math.min(cur.length + charsToAdd, target.length);
        return target.slice(0, nextLen);
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rawContent, pending, mode]);

  return shown;
}
