'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ArrowUp,
  AtSign,
  Hash,
  SlashSquare,
  Square,
  Mic,
  Maximize2,
  Minimize2,
  X,
  FileText,
} from 'lucide-react';
import ArticlePicker from './ArticlePicker';
import TagPicker from './TagPicker';
import SlashCommandPicker from './SlashCommandPicker';
import type { AgentArticle, AgentTag, SlashCommand } from '../../lib/agentResources';

type PickerKey = 'article' | 'tag' | 'slash' | null;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAbort?: () => void;
  busy: boolean;
  placeholder?: string;
  /** 移动端键盘弹起时的额外底边补偿。 */
  bottomSafeArea?: boolean;
  /** 在工具按钮前面渲染的额外槽位（典型：ModelPicker）。 */
  leadingSlot?: React.ReactNode;

  /** 当前会话已选中的文章 / 标签，用于在 picker 行高亮显示已选项 */
  selectedArticles?: AgentArticle[];
  selectedTags?: AgentTag[];
  onPickArticle?: (article: AgentArticle) => void;
  onPickTag?: (tag: AgentTag) => void;
  onSlashCommand?: (cmd: SlashCommand) => void;
  /** 用户从 mentions chip 上点 X 移除引用 */
  onRemoveArticle?: (id: number) => void;
  onRemoveTag?: (slug: string) => void;
}

/** Composer 暴露的命令式 API。 */
export interface ComposerHandle {
  focus: () => void;
  insert: (text: string) => void;
}

const MIN_HEIGHT = 48;
const DEFAULT_MAX = 220;
const EXPANDED_MAX = 480;

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    value,
    onChange,
    onSubmit,
    onAbort,
    busy,
    placeholder,
    bottomSafeArea = true,
    leadingSlot,
    selectedArticles = [],
    selectedTags = [],
    onPickArticle,
    onPickTag,
    onSlashCommand,
    onRemoveArticle,
    onRemoveTag,
  },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<PickerKey>(null);
  // 用户手动 resize 拖大后记录的高度,作为后续 auto-resize 的下限
  // —— 让 manual height 成为粘性偏好,不会被新输入的 auto-fit 强制塌回。
  const [userMinHeight, setUserMinHeight] = useState<number | null>(null);

  const atBtnRef = useRef<HTMLButtonElement>(null);
  const hashBtnRef = useRef<HTMLButtonElement>(null);
  const slashBtnRef = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    insert: (text: string) => insertChar(text),
  }));

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const max = expanded ? EXPANDED_MAX : DEFAULT_MAX;
    el.style.height = 'auto';
    const fitted = Math.max(MIN_HEIGHT, Math.min(el.scrollHeight, max));
    // userMinHeight 让 manual resize 后保留拖大尺寸 —— 即便清空内容也不回缩。
    el.style.height = `${userMinHeight ? Math.max(fitted, userMinHeight) : fitted}px`;
  }, [value, expanded, userMinHeight]);

  // 监听用户拖拽 textarea 右下角 native resize 把手,并把最新手动高度写成粘性偏好。
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    let downH = el.offsetHeight;
    const onDown = () => {
      downH = el.offsetHeight;
    };
    const onUp = () => {
      const upH = el.offsetHeight;
      if (Math.abs(upH - downH) > 4) {
        setUserMinHeight(upH);
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, []);

  // 切换 expanded 或 value 清空时重置用户高度偏好,回到 auto-fit。
  useEffect(() => {
    if (!value) setUserMinHeight(null);
  }, [value, expanded]);

  function insertChar(text: string) {
    const el = taRef.current;
    if (!el) {
      onChange((value ?? '') + text);
      requestAnimationFrame(() => taRef.current?.focus());
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) return;
      e.preventDefault();
      if (!busy && value.trim()) onSubmit();
    }
  };

  const togglePicker = (k: Exclude<PickerKey, null>) => {
    setPicker((curr) => (curr === k ? null : k));
  };

  const selectedArticleIds = new Set(selectedArticles.map((a) => a.id));
  const selectedTagSlugs = new Set(selectedTags.map((t) => t.slug));

  const canSend = !!value.trim() && !busy;

  return (
    <div className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSubmit();
        }}
        className={[
          'group/composer rounded-2xl px-3 pt-3 pb-2',
          'transition-[box-shadow,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'bg-[var(--bg-leaf)] backdrop-blur-xl',
          'border',
          focused
            ? 'border-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)] shadow-[0_10px_32px_-12px_color-mix(in_oklch,var(--aurora-1)_50%,transparent),0_0_0_4px_color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
            : 'border-[var(--ink-subtle)]/22 shadow-[0_4px_16px_-10px_rgba(0,0,0,0.18)]',
        ].join(' ')}
        style={bottomSafeArea ? { paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' } : undefined}
      >
        {/* mentions 区 —— 选中的文章 / 标签作为胶囊显示在 textarea 上方,
            包在同一个 form 容器内,视觉上与 textarea 一体。Codex/ChatGPT 风格:
            rounded-full 极致胶囊,精致图标 + 文字 + 点击 ✕ 同步清掉 pending +
            draft 残留 token。 */}
        {(selectedArticles.length > 0 || selectedTags.length > 0) && (
          <div
            className="mb-2 -mx-0.5 flex flex-wrap items-center gap-1.5"
            aria-label="已引用上下文"
          >
            {selectedArticles.map((a) => (
              <span
                key={`art-${a.id}`}
                className="group/chip inline-flex items-center gap-1.5 pl-2.5 pr-1 py-[3px] rounded-full text-[12px] leading-tight max-w-[15rem] transition-all"
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in oklch, var(--aurora-1) 14%, transparent), color-mix(in oklch, var(--aurora-1) 8%, transparent))',
                  border: '1px solid color-mix(in oklch, var(--aurora-1) 36%, transparent)',
                  color: 'var(--aurora-1)',
                  boxShadow:
                    '0 1px 0 inset color-mix(in oklch, var(--aurora-1) 14%, transparent), 0 2px 6px -3px color-mix(in oklch, var(--aurora-1) 38%, transparent)',
                }}
              >
                <FileText className="w-3 h-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                <span className="truncate font-medium tracking-tight" title={a.title}>{a.title}</span>
                {onRemoveArticle && (
                  <button
                    type="button"
                    onClick={() => onRemoveArticle(a.id)}
                    className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[var(--aurora-1)]/75 hover:text-white hover:bg-[var(--aurora-1)] transition-colors"
                    aria-label={`移除引用 ${a.title}`}
                  >
                    <X className="w-3 h-3" strokeWidth={2.75} />
                  </button>
                )}
              </span>
            ))}
            {selectedTags.map((t) => (
              <span
                key={`tag-${t.slug}`}
                className="group/chip inline-flex items-center gap-1.5 pl-2.5 pr-1 py-[3px] rounded-full text-[12px] leading-tight max-w-[12rem] bg-[var(--bg-raised)] border border-[var(--ink-subtle)]/30 text-[var(--ink-primary)] shadow-[0_1px_0_inset_rgba(255,255,255,0.04),0_2px_6px_-3px_rgba(0,0,0,0.12)] transition-all"
              >
                <Hash className="w-3 h-3 shrink-0 text-[var(--ink-muted)]" strokeWidth={2.25} aria-hidden="true" />
                <span className="truncate font-medium tracking-tight" title={t.name}>{t.name}</span>
                {onRemoveTag && (
                  <button
                    type="button"
                    onClick={() => onRemoveTag(t.slug)}
                    className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-leaf)] transition-colors"
                    aria-label={`移除标签 ${t.name}`}
                  >
                    <X className="w-3 h-3" strokeWidth={2.75} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={1}
          aria-label="消息输入框"
          placeholder={placeholder ?? '提问、创建或开始任务。@ 引用文章 · / 调用命令'}
          className="agent-composer-textarea w-full bg-transparent outline-none text-[14.5px] text-[var(--ink-primary)] placeholder-[var(--ink-muted)]/65 leading-[1.55]"
          style={{ resize: 'vertical', minHeight: `${MIN_HEIGHT}px` }}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[var(--ink-muted)] min-w-0">
            {leadingSlot && (
              <>
                <div className="flex-shrink-0">{leadingSlot}</div>
                <span aria-hidden="true" className="hidden sm:inline-block w-px h-4 bg-[var(--ink-subtle)]/22 mx-1" />
              </>
            )}
            <ToolButton
              ref={atBtnRef}
              title="引用文章"
              active={picker === 'article'}
              onClick={() => (onPickArticle ? togglePicker('article') : insertChar('@'))}
            >
              <AtSign className="w-3.5 h-3.5" />
            </ToolButton>
            <ToolButton
              ref={hashBtnRef}
              title="按标签筛选"
              active={picker === 'tag'}
              onClick={() => (onPickTag ? togglePicker('tag') : insertChar('#'))}
            >
              <Hash className="w-3.5 h-3.5" />
            </ToolButton>
            <ToolButton
              ref={slashBtnRef}
              title="斜杠命令"
              active={picker === 'slash'}
              onClick={() => (onSlashCommand ? togglePicker('slash') : insertChar('/'))}
            >
              <SlashSquare className="w-3.5 h-3.5" />
            </ToolButton>
            {/* 语音输入暂为占位 —— 移动端横向空间紧张时优先让出给主要工具
                （@ # /），桌面端继续暴露占位以维持视觉提示功能。 */}
            <ToolButton title="语音输入（待接入）" disabled mobileHidden>
              <Mic className="w-3.5 h-3.5" />
            </ToolButton>
            <span className="hidden lg:inline ml-1.5 font-mono text-[10px] uppercase tracking-[0.22em] truncate">
              Enter 发送 · Shift+Enter 换行
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起输入框' : '展开输入框'}
              aria-label={expanded ? '收起输入框' : '展开输入框'}
              className="hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--ink-primary)] transition-colors"
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            {busy ? (
              <button
                type="button"
                onClick={onAbort}
                aria-label="停止生成"
                className="group/stop relative inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] transition-all text-[12px] font-medium active:scale-95"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-xl pointer-events-none"
                  style={{ animation: 'breath-soft 2.4s ease-in-out infinite' }}
                />
                <Square className="w-3 h-3 fill-current" />
                停止
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="发送"
                className={[
                  'relative inline-flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200',
                  canSend
                    ? 'bg-[var(--aurora-1)] text-white shadow-[0_6px_18px_-6px_color-mix(in_oklch,var(--aurora-1)_55%,transparent)] hover:brightness-110 hover:shadow-[0_10px_24px_-6px_color-mix(in_oklch,var(--aurora-1)_70%,transparent)] hover:-translate-y-px active:translate-y-0 active:scale-95'
                    : 'bg-[var(--ink-subtle)]/25 text-[var(--ink-muted)] cursor-not-allowed border border-[var(--ink-subtle)]/30',
                ].join(' ')}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Picker 弹层 —— 锚到对应的 ToolButton。
            选中后立即关闭弹层,避免遮挡刚加进胶囊区的 chip;要多选则用户再次点
            @ / # / / 重新打开,符合 ChatGPT/Codex 的"挑一项就收"的快进交互。 */}
        {onPickArticle && (
          <ArticlePicker
            open={picker === 'article'}
            onClose={() => setPicker(null)}
            anchorRef={atBtnRef}
            selectedIds={selectedArticleIds}
            onPick={(a) => {
              onPickArticle(a);
              setPicker(null);
            }}
          />
        )}
        {onPickTag && (
          <TagPicker
            open={picker === 'tag'}
            onClose={() => setPicker(null)}
            anchorRef={hashBtnRef}
            selectedSlugs={selectedTagSlugs}
            onPick={(t) => {
              onPickTag(t);
              setPicker(null);
            }}
          />
        )}
        {onSlashCommand && (
          <SlashCommandPicker
            open={picker === 'slash'}
            onClose={() => setPicker(null)}
            anchorRef={slashBtnRef}
            onPick={(cmd) => {
              onSlashCommand(cmd);
              setPicker(null);
            }}
          />
        )}
      </form>
    </div>
  );
});

interface ToolButtonProps {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  /** mobileHidden=true 时移动端隐藏，仅 ≥md 渲染。用于次要工具（如语音占位）
   *  腾出移动端单手操作的横向空间。 */
  mobileHidden?: boolean;
}

const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { children, title, disabled, active, onClick, mobileHidden },
  ref,
) {
  // 触控区：移动端 36×36（HIG 推荐 44，单手操作密集排列下选 36 平衡密度）；
  // 桌面 28×28（hover-friendly 紧凑形态）。
  const sizeClass = mobileHidden
    ? 'hidden md:inline-flex w-7 h-7'
    : 'inline-flex w-9 h-9 md:w-7 md:h-7';
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`${sizeClass} items-center justify-center rounded-lg transition-all duration-200 ${
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : active
          ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)] ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_35%,transparent)] active:scale-95'
          : 'hover:bg-[var(--bg-raised)] hover:text-[var(--aurora-1)] active:scale-95'
      }`}
    >
      {children}
    </button>
  );
});

export default Composer;
