import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  ElementType,
  KeyboardEvent,
  ReactNode,
  RefObject,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AtSign,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  FileSearch,
  FileText,
  GitBranch,
  GitFork,
  Hash,
  ImagePlus,
  Languages,
  Layers3,
  LayoutDashboard,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Quote,
  RefreshCcw,
  Scissors,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sidebar as SidebarIcon,
  SlashSquare,
  SquarePen,
  Sparkles,
  Square,
  Sun,
  Trash2,
  User as UserIcon,
  Wrench,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Virtualizer, type VirtualizerHandle } from 'virtua';
import { toast } from 'sonner';
import { AetherMark, ConfirmModal } from '@aetherblog/ui';
import { useAetherHubPresenceStore } from '@/stores/aetherHubPresenceStore';
import { MarkdownPreview, MarkdownStreamPreview } from '@aetherblog/editor';
import { formatDate } from '@aetherblog/utils';
import { useAuthStore } from '@/stores';
import { useMediaQuery, useModalDialog, useTheme } from '@/hooks';
import { getMediaUrl } from '@/services/mediaService';
import {
  fetchAgentKnowledgeBases,
  type AgentKnowledgeBase,
} from '@/services/knowledgeBaseService';
import { atlasService } from '@/services/atlasService';
import { agentWorkflowService } from '@/services/agentWorkflowService';
import {
  consumeKnowledgeWorkspaceHandoff,
} from '@/services/knowledgeWorkspaceHandoff';
import type { AtlasKnowledgePoint } from '@aetherblog/types';
import { cn } from '@/lib/utils';
import { CachedAvatar } from '@/components/common/CachedAvatar';
import { AetherHubSkeleton } from './AetherHubSkeleton';
import {
  type AgentAlternative,
  type AgentArticle,
  type AgentAttachment,
  type AgentModelItem,
  type AgentModelParams,
  type AgentTag,
  type AgentMessage,
  type AgentRetrievalReceipt,
  type AgentRequestSnapshotV1,
  type AgentSession,
  type AgentToolEvent,
  type AgentTranslation,
  type AgentUsage,
  type ChatStreamRequest,
  type SlashCommand,
  type StreamAnimationMode,
  ARTICLE_PAGE_SIZE,
  attachmentTokenEstimate,
  attachmentsWithinBudget,
  budgetHistory,
  collectAttachmentIds,
  collectReclaimableAttachmentIds,
  compressImageIfNeeded,
  CONTEXT_CHAR_BUDGET,
  configureAgentSessionSync,
  createEmptySession,
  deleteAgentSessionRemote,
  deleteAttachmentData,
  deriveSessionTitle,
  getAttachmentData,
  estimateMessagesTokens,
  exportFileName,
  fileToAttachment,
  filterSlashCommands,
  filterTags,
  flushSaveSessions,
  formatTokenCount,
  groupSessionsByRecency,
  isSessionAwaitingHydration,
  linkifyCitations,
  loadSessions,
  MAX_IMAGES_PER_MESSAGE,
  MAX_TOTAL_ATTACHMENT_DATAURL_BYTES,
  mergeAdoptedServerSession,
  modelLabel,
  newMessageId,
  normalizeCjkInlineMarkdown,
  normalizeContextBreak,
  notifyAgentSessionActivated,
  parseCitationRank,
  providerLabel,
  putAttachmentData,
  readAgentSessionDraft,
  reconcileAgentSessions,
  resolveAgentSessionDraftAfterRequestStart,
  retryAgentSessionHydration,
  sanitizeGeneratedSessionTitle,
  scheduleAgentSessionSync,
  scheduleSaveSessions,
  sessionToMarkdown,
  sliceContextMessages,
  streamAgentChat,
  useAgentModels,
  useAllTags,
  useArticleSearch,
  validateImageFile,
  withAgentSessionDraft,
} from '@/services/agent';
import {
  clearSessionKnowledgeHandoff,
  createAetherHubRequestSnapshot,
  getSessionKnowledgeHandoff,
  preserveContextSelectionKeysAfterSuccess,
  preserveSessionKnowledgeHandoffAfterSuccess,
  readAetherHubRequestSnapshot,
  resolveAetherHubKnowledgeContext,
  selectAetherHubKnowledgeContext,
  type SessionKnowledgeHandoff,
} from './aetherHubKnowledgeContext';
import { RetrievalReceiptCard } from './RetrievalReceiptCard';

function workflowErrorMessage(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: unknown } }; message?: unknown };
  const responseMessage = candidate.response?.data?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim()) return responseMessage;
  if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  return fallback;
}

// 附件原图的内存缓存 —— localStorage 有 ~5MB 配额，base64 原图必然挤爆并
// 连带毁掉整份会话持久化；所以会话里只存去掉 dataUrl 的附件元信息，原图在
// 这里按 id 缓存，刷新后由 IndexedDB 回填（都取不到才降级为占位卡片）。
//
// 为什么必须有上限：本缓存最初只在 handleSend 写入（生命周期 = 本次发送），
// 但 AttachmentImage 的三级降级读取新增了「每张滚入视口的历史图片都回填缓存」
// 的通道 —— 虚拟化列表滚一遍图多的会话就能把几百 MB base64 永久钉在内存里，
// 而删除只发生在 reclaimAttachments（删会话 / 截断消息）。这里用「按字节数的
// LRU」封顶：Map 天然保持插入序，命中时 delete+set 提升为最近使用，超限时从
// 队首（最久未使用）淘汰。淘汰只丢内存副本 —— IndexedDB 才是持久层，下次滚
// 回来照样能取到。
const ATTACHMENT_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const attachmentDataUrlCache = new Map<string, string>();
// dataURL 是纯 ASCII（base64 + mime 前缀），字符数即字节数，无需额外编码开销。
let attachmentCacheBytes = 0;

/** 读缓存并提升为最近使用（LRU 的 recency 记账全在这一处）。 */
function readAttachmentCache(id: string): string | undefined {
  const hit = attachmentDataUrlCache.get(id);
  if (hit === undefined) return undefined;
  attachmentDataUrlCache.delete(id);
  attachmentDataUrlCache.set(id, hit);
  return hit;
}

/** 写缓存并按字节上限淘汰队首。单张就超限时至少保留刚写入的这张。 */
function writeAttachmentCache(id: string, dataUrl: string): void {
  dropAttachmentCache(id);
  attachmentDataUrlCache.set(id, dataUrl);
  attachmentCacheBytes += dataUrl.length;
  for (const [key, value] of attachmentDataUrlCache) {
    if (attachmentCacheBytes <= ATTACHMENT_CACHE_MAX_BYTES) break;
    if (key === id) break; // 队尾即刚写入的这张，不自我淘汰
    attachmentDataUrlCache.delete(key);
    attachmentCacheBytes -= value.length;
  }
}

/** 单条淘汰 —— 供 reclaimAttachments 的引用计数回收调用。 */
function dropAttachmentCache(id: string): void {
  const existing = attachmentDataUrlCache.get(id);
  if (existing === undefined) return;
  attachmentDataUrlCache.delete(id);
  attachmentCacheBytes -= existing.length;
}

/** 整体清空 —— 页面卸载时调用：内存缓存只服务「重挂载窗口」，持久层是 IndexedDB。 */
function clearAttachmentCache(): void {
  attachmentDataUrlCache.clear();
  attachmentCacheBytes = 0;
}

// 会话标题 AI 自动生成的「每会话只试一次」登记 —— 模块级：切换会话 / 组件
// 重挂载都不清零；失败静默不重试，避免反复占用模型配额与打扰用户。
const autoTitleAttemptedSessions = new Set<string>();

// 空态推荐提示词 —— 面向「博客管理员在后台的日常任务」，而不是开发者自测。
// 凡是要读站内内容的都得带 needsKnowledge：默认知识范围是「不检索」，否则点了
// 建议词也召不回任何东西，用户会以为知识库坏了。文章走的就是知识库路径 ——
// SYSTEM_POSTS 是「博客文章自动构成的系统库」，且后端 agentKBUsable 对它无条件
// 放行，所以 auto 一定会把它注进来（普通 KB 还要求有 active profile + chunks）。
const promptChips: Array<{ text: string; needsKnowledge?: boolean }> = [
  { text: '检索知识库，总结本站内容策略的核心要点', needsKnowledge: true },
  // 刻意不写「草稿」，也刻意不写「最近 / 上个月」这类时间限定：
  //   - 草稿：文章检索的两条路都只面向已发布内容（SYSTEM_POSTS 按 post_embeddings
  //     建索引，search_posts 又硬过滤 status='PUBLISHED' 且默认关闭）。
  //   - 时间：_recall_system_posts 纯按 embedding 距离排序后取 top-N，既不带
  //     published_at 也没有日期过滤，给不出「最新一篇」或「某月全部」。
  // 建议词只承诺检索能兑现的范围，否则模型只能编造或反问。
  { text: '挑一篇站内文章，提炼成 200 字社媒预告', needsKnowledge: true },
  { text: '为检索到的几篇站内文章各写一句推荐语', needsKnowledge: true },
  { text: '用表格整理当前可用 AI 模型的能力差异' },
];

type DisplayMode = 'bubble' | 'engraved';
type SendShortcut = 'enter' | 'mod-enter';
type CapabilityPanelTab = 'space' | 'params';
type SpacePreviewTarget =
  | { kind: 'article'; article: AgentArticle }
  | { kind: 'kb'; kb: AgentKnowledgeBase }
  | { kind: 'atlas'; kp: AtlasKnowledgePoint }
  | { kind: 'tag'; tag: AgentTag };

/** 附件原图大图预览的目标（页面级单例，见 AttachmentPreviewContext）。 */
interface AttachmentPreviewTarget {
  src: string;
  name: string;
}

/**
 * 大图预览的「请求打开」通道。
 *
 * 为什么要提到页面级：预览此前挂在 AttachmentImage 自己的 state 上，而
 * AttachmentImage 活在虚拟化消息行的子树里 —— 消息行滚出缓冲区即卸载，
 * 打开中的预览会毫无征兆地自己消失。状态提到页面、浮层渲染在虚拟化列表
 * 之外，才与滚动解耦。
 *
 * 用 context 而不是逐层传 prop：链路是
 * WorkspaceCanvas → MessageRow → UserContent → UserAttachments →
 * AttachmentImage，五层组件各自已有大量 props，穿一个回调进去纯属噪声。
 */
const AttachmentPreviewContext = createContext<((target: AttachmentPreviewTarget) => void) | null>(
  null,
);

/**
 * 多模型对比：打开浮层那一刻从目标 assistant 消息冻结的重放上下文。
 * 语义与 handleRetryMessage 完全一致 —— baseMessages 是「前置 user 消息之前」
 * 的历史，requestSnapshot 来自前置 user 消息（缺失时退回 auto 契约）。
 */
interface CompareTarget {
  sessionId: string;
  /** 被对比 / 采纳时被替换的 assistant 消息 id。 */
  messageId: string;
  /** 前置 user 消息正文（对比的「原问题」）。 */
  question: string;
  baseMessages: AgentMessage[];
  contextBreakId: string | null;
  requestSnapshot: AgentRequestSnapshotV1;
  sessionModelId: string | null;
  sessionProviderCode: string | null;
  sessionModelParams: AgentModelParams | undefined;
  /** 被替换的原回答（采纳时随其余完成列一起存入 alternatives）。 */
  original: AgentMessage;
}

/** 对比浮层的单列流式状态 —— 只活在浮层本地，采纳前不进 sessions。 */
interface CompareColumn {
  key: string;
  model: AgentModelItem;
  status: 'streaming' | 'done' | 'error';
  content: string;
  think: string;
  error?: string;
  usage?: AgentUsage;
  startedAt: number;
  firstTokenAt?: number;
  finishedAt?: number;
}

const COMPARE_MIN_MODELS = 2;
const COMPARE_MAX_MODELS = 3;

function compareModelKey(model: AgentModelItem): string {
  return `${model.providerCode}::${model.modelId}`;
}

const SEND_SHORTCUT_STORAGE_KEY = 'aetherblog.admin.aetherhub.sendShortcut';
const ENABLE_TOOLS_STORAGE_KEY = 'aetherblog.admin.aetherhub.enableTools';
const SEND_SHORTCUT_OPTIONS: Array<{
  value: SendShortcut;
  label: string;
  keys: string;
  description: string;
}> = [
  {
    value: 'enter',
    label: 'Enter 发送',
    keys: '↵',
    description: 'Shift + Enter 保持换行',
  },
  {
    value: 'mod-enter',
    label: '⌘ / Ctrl + Enter 发送',
    keys: '⌘ ↵',
    description: 'Enter 直接换行',
  },
];

function describeAetherHubAtlasScope(kpIds: readonly number[]): string {
  if (kpIds.length === 0) return 'kp_ids=none';
  return `kp_ids=${kpIds.join(',')}`;
}

type StandardModelParamKey =
  | 'temperature'
  | 'top_p'
  | 'max_tokens'
  | 'presence_penalty'
  | 'frequency_penalty';

type ModelParamSchema = Record<string, unknown>;

interface NumericModelParam {
  key: StandardModelParamKey;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  tag: string;
  source: 'model' | 'default';
}

const STANDARD_MODEL_PARAMS: Record<
  StandardModelParamKey,
  Omit<NumericModelParam, 'key' | 'source'>
> = {
  temperature: {
    label: '创造性',
    description: 'temperature · 数值越高越发散',
    min: 0,
    max: 2,
    step: 0.1,
    defaultValue: 0.7,
    tag: 'temperature',
  },
  top_p: {
    label: '开放度',
    description: 'top_p · 控制候选 token 截断范围',
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 1,
    tag: 'top_p',
  },
  max_tokens: {
    label: '最大输出',
    description: 'max_tokens · 限制单次回答长度',
    min: 256,
    max: 4096,
    step: 256,
    defaultValue: 4096,
    tag: 'max_tokens',
  },
  presence_penalty: {
    label: '话题发散',
    description: 'presence_penalty · 鼓励引入新话题',
    min: -2,
    max: 2,
    step: 0.1,
    defaultValue: 0,
    tag: 'presence_penalty',
  },
  frequency_penalty: {
    label: '重复抑制',
    description: 'frequency_penalty · 降低重复词句概率',
    min: -2,
    max: 2,
    step: 0.1,
    defaultValue: 0,
    tag: 'frequency_penalty',
  },
};

const STANDARD_PARAM_ORDER: StandardModelParamKey[] = [
  'temperature',
  'top_p',
  'max_tokens',
  'presence_penalty',
  'frequency_penalty',
];

const REASONING_EXTEND_PARAM_KEYS = new Set([
  'reasoningEffort',
  'gpt5ReasoningEffort',
  'gpt5_1ReasoningEffort',
  'gpt5_2ReasoningEffort',
  'gpt5_2ProReasoningEffort',
  'grok4_20ReasoningEffort',
  'grok4_3ReasoningEffort',
  'hy3ReasoningEffort',
  'codexMaxReasoningEffort',
]);

const REASONING_EFFORT_OPTIONS = [
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

const TEXT_VERBOSITY_OPTIONS = [
  { value: 'low', label: '简洁' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '详细' },
];

const THINKING_LEVEL_OPTIONS = [
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function modelParamsSchema(model: AgentModelItem | null): ModelParamSchema {
  return isRecord(model?.parameters) ? model.parameters : {};
}

function modelDisabledParams(model: AgentModelItem | null): Set<string> {
  const disabled = Array.isArray(model?.disabledParams)
    ? model.disabledParams
    : Array.isArray(model?.settings?.disabledParams)
      ? (model.settings.disabledParams as unknown[])
      : [];
  return new Set(disabled.map((item) => String(item)));
}

function modelExtendParams(model: AgentModelItem | null): string[] {
  if (Array.isArray(model?.extendParams)) return model.extendParams;
  const raw = model?.settings?.extendParams;
  return Array.isArray(raw) ? raw.map((item) => String(item)).filter(Boolean) : [];
}

function readParamSchemaValue(schema: unknown, key: string): unknown {
  if (!isRecord(schema)) return undefined;
  return schema[key];
}

function readParamDefault(schema: unknown): number | null {
  if (typeof schema === 'number' || typeof schema === 'string') return finiteNumber(schema);
  return (
    finiteNumber(readParamSchemaValue(schema, 'default')) ??
    finiteNumber(readParamSchemaValue(schema, 'defaultValue')) ??
    finiteNumber(readParamSchemaValue(schema, 'value'))
  );
}

function buildNumericModelParams(model: AgentModelItem | null): NumericModelParam[] {
  const schema = modelParamsSchema(model);
  const disabled = modelDisabledParams(model);
  const modelMaxOutput = model?.maxOutputTokens && model.maxOutputTokens > 0
    ? model.maxOutputTokens
    : null;

  return STANDARD_PARAM_ORDER.flatMap((key) => {
    if (disabled.has(key)) return [];
    const base = STANDARD_MODEL_PARAMS[key];
    const paramSchema = schema[key];
    const fromModel = paramSchema !== undefined;
    const min = finiteNumber(readParamSchemaValue(paramSchema, 'min')) ?? base.min;
    const max =
      key === 'max_tokens'
        ? finiteNumber(readParamSchemaValue(paramSchema, 'max')) ?? modelMaxOutput ?? base.max
        : finiteNumber(readParamSchemaValue(paramSchema, 'max')) ?? base.max;
    const step = finiteNumber(readParamSchemaValue(paramSchema, 'step')) ?? base.step;
    const defaultValue =
      readParamDefault(paramSchema) ??
      (key === 'max_tokens' && modelMaxOutput ? Math.min(modelMaxOutput, base.defaultValue) : base.defaultValue);

    return [
      {
        ...base,
        key,
        min,
        max: Math.max(max, min),
        step,
        defaultValue,
        source: fromModel ? 'model' : 'default',
      },
    ];
  });
}

/**
 * 模型清单正在后台重拉 —— `items` 仍是上一轮的旧值。
 *
 * 重拉期间旧清单里可能还留着刚在 /ai-config 停用的模型：拿它发请求只会换来后端
 * 「Requested model not found」，而清空回落自动路由的对账要等重拉落地才跑得了。
 * 所有会发起模型请求的入口（handleSend 及其重试 / 编辑 / `/regen` 复用者、多模型
 * 对比）都必须先过这道判定 —— 只放在输入框上会被这些路径绕过去。
 */
function isModelCatalogRevalidating(
  modelsState: ReturnType<typeof useAgentModels>,
): boolean {
  return modelsState.status === 'ready' && modelsState.revalidating === true;
}

function currentModelFromSession(
  session: AgentSession | null,
  modelsState: ReturnType<typeof useAgentModels>,
): AgentModelItem | null {
  if (!session?.modelId || modelsState.status !== 'ready') return null;
  return (
    modelsState.items.find(
      (m) => m.modelId === session.modelId && m.providerCode === session.providerCode,
    ) ?? null
  );
}

function effectiveParamValue(
  session: AgentSession | null,
  param: NumericModelParam,
): number {
  const raw = session?.modelParams?.[param.key];
  const value = finiteNumber(raw);
  if (value == null) return param.defaultValue;
  return Math.min(param.max, Math.max(param.min, value));
}

function cleanModelParams(params: AgentModelParams | undefined): AgentModelParams | undefined {
  if (!params) return undefined;
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as AgentModelParams;
}

function buildModelParamsForRequest(
  model: AgentModelItem | null,
  sessionParams: AgentModelParams | undefined,
): AgentModelParams | null {
  const schema = modelParamsSchema(model);
  const disabled = modelDisabledParams(model);
  const fromModel = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !disabled.has(key))
      .map(([key, value]) => [key, readParamDefault(value)])
      .filter(([, value]) => value !== null),
  ) as AgentModelParams;
  const overrides = Object.fromEntries(
    Object.entries(sessionParams || {}).filter(([key]) => !disabled.has(key)),
  ) as AgentModelParams;
  const merged = cleanModelParams({ ...fromModel, ...overrides });
  return merged || null;
}

function readSendShortcut(): SendShortcut {
  if (typeof window === 'undefined') return 'enter';
  const stored = window.localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY);
  return stored === 'mod-enter' ? 'mod-enter' : 'enter';
}

function formatContextWindow(value?: number | null): string | null {
  if (!value || value <= 0) return null;
  if (value >= 1_000_000) {
    const rounded = Math.round((value / 1_000_000) * 10) / 10;
    return `${String(rounded).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

interface CurrentUser {
  id: string;
  nickname: string;
  initial: string;
  avatarUrl: string | null;
}

function pickGreeting(hour: number): string {
  if (hour >= 5 && hour < 11) return '早上好';
  if (hour >= 11 && hour < 13) return '中午好';
  if (hour >= 13 && hour < 18) return '下午好';
  return '晚上好';
}

/**
 * @param onRoute 当前路由是否停在 /aetherhub。工作台被 AetherHubKeepAliveHost
 * 跨路由保活（不卸载），所以「离开 / 重新进入」不再对应挂载与卸载，只能靠这个
 * 信号补做两类事：离开时收掉 portal 到 document.body、逃出保活容器 visibility
 * 的浮层；重新进入时补跑那些原本只在挂载期跑一次的一次性逻辑。
 */
export default function AetherHubWorkspacePage({ onRoute = true }: { onRoute?: boolean } = {}) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const currentUser = useMemo<CurrentUser>(() => {
    const nickname = user?.nickname?.trim() || '管理员';
    return {
      id: user?.id ?? 'anon',
      nickname,
      initial: Array.from(nickname)[0]?.toUpperCase() ?? 'A',
      avatarUrl: user?.avatar ? getMediaUrl(user.avatar) : null,
    };
  }, [user?.id, user?.nickname, user?.avatar]);

  // ----- 会话状态：localStorage 持久化，每个 user 独立 namespace。 -----
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const list = loadSessions(currentUser.id);
    if (list.length === 0) {
      const fresh = createEmptySession('chat');
      setSessions([fresh]);
      setActiveId(fresh.id);
    } else {
      setSessions(list);
      setActiveId(list.sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
    }
    setHydrated(true);
  }, [currentUser.id]);

  // 落盘走尾沿节流：流式期间每个 delta 都会触发本 effect，直接同步
  // JSON.stringify 整个会话数组等于每秒几十次全量序列化（主线程可感知卡顿）。
  // scheduleSaveSessions 合并写请求，并在 pagehide 时强制 flush 防丢。
  useEffect(() => {
    if (!hydrated) return;
    scheduleSaveSessions(currentUser.id, sessions);
    // 云同步共用同一触发点：flush 时只推「updatedAt 变化且无 pending 流/翻译」
    // 的会话 —— 流式期间自然跳过，等流结束后的那次 flush（细节在 sessionsSync.ts）。
    scheduleAgentSessionSync(sessions);
  }, [hydrated, currentUser.id, sessions]);
  useEffect(() => flushSaveSessions, []);
  // 离开页面即清空附件原图内存缓存 —— 持久层是 IndexedDB，内存副本只服务
  // 「本次挂载 + 虚拟化重挂载」窗口，留着只会白占几十 MB。
  useEffect(() => clearAttachmentCache, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const updateSession = useCallback(
    (id: string, updater: (s: AgentSession) => AgentSession) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    },
    [],
  );

  /**
   * 懒加载门禁 —— 会话仍在等待云端全量时，任何「会 bump updatedAt」的变更都必须拦下。
   *
   * 为什么：serverNewer 标记在场期间，本地那份只是空壳 / 旧壳占位，不是权威版本。
   * 此刻 bump updatedAt 会同时踩死两条路：
   *   · flush 拒绝 PUT（sessionsSync 对 awaiting-hydration 的会话不推送，改为触发重试）；
   *   · 懒加载真的回来了，也会被 mergeAdoptedServerSession 的
   *     `local.updatedAt > server.updatedAt` 判定为「本地更新」而拒绝采纳。
   * 双向死锁 → 该会话本轮生命周期永久卡死；更糟的是刷新之后，这个空壳带着更晚的
   * updatedAt 赢下 LWW，把服务端的全量历史整个覆盖掉。
   *
   * 所以：拦下本次变更 + 主动触发一次懒加载重试，让用户等加载完再操作。toast 带固定
   * id 去重，避免用户连点时糊一屏。
   */
  const ensureSessionHydrated = useCallback((id: string, silent = false) => {
    if (!isSessionAwaitingHydration(id)) return true;
    if (!silent) {
      toast.info('该对话正在从云端加载，请稍候', { id: 'aetherhub-awaiting-hydration' });
    }
    retryAgentSessionHydration(id);
    return false;
  }, []);

  /**
   * 会话写入的统一入口 —— 所有会 bump updatedAt（= 参与云同步 LWW 竞争）的变更走这里。
   *
   * 反过来说，**纯本地态不该被拦**，它们继续直接用 updateSession：
   *   · 草稿（setComposer / withAgentSessionDraft）—— 不 bump updatedAt，且 merge 采纳
   *     时会被显式保留，拦住只会让用户在等加载期间连字都打不了；
   *   · 置顶 / 重命名 / 上下文断点 —— 同样不 bump updatedAt（sessionsSync 头注释里
   *     「置顶/重命名不 bump updatedAt」是有意取舍），既不会赢 LWW，也不会阻塞 flush。
   * 流式管线的逐帧写入（patchAssistant 等）也不走这里：handleSend 已在发起前过了同一道
   * 门禁，且流式期间的会话本就被 flush / 采纳双向排除，中途再拦只会打断正在跑的流。
   */
  const mutateSyncedSession = useCallback(
    (
      id: string,
      updater: (s: AgentSession) => AgentSession,
      options?: { silent?: boolean },
    ) => {
      if (!ensureSessionHydrated(id, options?.silent)) return false;
      updateSession(id, updater);
      return true;
    },
    [ensureSessionHydrated, updateSession],
  );

  // 异步收尾逻辑（标题自动生成 / 附件清理）需要读「此刻」的会话状态 ——
  // 闭包里捕获的 sessions 在流式结束时早已过期，这里用 ref 供其穿透读取。
  const sessionsRef = useRef<AgentSession[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // ----- Greeting tick：跨过整点时切换 -----
  const [greeting, setGreeting] = useState(() => pickGreeting(new Date().getHours()));
  useEffect(() => {
    const id = window.setInterval(
      () => setGreeting(pickGreeting(new Date().getHours())),
      60_000,
    );
    return () => window.clearInterval(id);
  }, []);

  // ----- 路由重入计数 -----
  // 保活实例只挂载一次，于是「回到灵境」不再触发任何挂载期逻辑。这个计数在
  // 每次 onRoute false → true 时 +1，供下面几处一次性副作用当重跑依据。
  const [routeEntryCount, setRouteEntryCount] = useState(0);
  const wasOnRouteRef = useRef(onRoute);
  useEffect(() => {
    if (onRoute && !wasOnRouteRef.current) setRouteEntryCount((n) => n + 1);
    wasOnRouteRef.current = onRoute;
  }, [onRoute]);

  // ----- 模型清单 -----
  // 用户很可能刚从模型选择器跳去 /ai-config 改完供应商再回来 —— 保活实例不重
  // 挂载，不带 routeEntryCount 就会一直用进入灵境那一刻的旧清单。
  const modelsState = useAgentModels(true, routeEntryCount);

  // ----- Composer 状态 -----
  const composer = readAgentSessionDraft(activeSession);
  const setComposer = useCallback(
    (value: string) => {
      if (!activeId) return;
      updateSession(activeId, (session) => withAgentSessionDraft(session, value));
    },
    [activeId, updateSession],
  );
  // ----- 每会话独立流 -----
  // 流式状态从「全局单布尔」升级为「会话 id 集合」：A 会话生成时可以自由切到
  // B 会话继续提问（对齐 ChatGPT / LobeHub），只有同一会话内不允许并发两条流。
  // rAF 管线的所有写入都以闭包里 pin 住的 sessionId/messageId 为准，天然防串台。
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(() => new Set());
  const streamingIdsRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef(new Map<string, AbortController>());
  // 辅助流（翻译 / 自动起名）的 AbortController 集合 —— 不占会话级
  // streamingIds，但卸载时必须一并掐断，防止路由离开后网络流空转。
  const auxControllersRef = useRef(new Set<AbortController>());
  // 卸载即断流：会话回答流 + 全部辅助流。rAF 管线由各自的 AbortError 分支
  // 收尾；卸载后的 setState 在 React 18 是安全 no-op。
  useEffect(() => {
    const mainControllers = abortControllersRef.current;
    const auxControllers = auxControllersRef.current;
    return () => {
      for (const controller of mainControllers.values()) controller.abort();
      mainControllers.clear();
      for (const controller of auxControllers) controller.abort();
      auxControllers.clear();
    };
  }, []);
  const markStreaming = useCallback((id: string, on: boolean) => {
    const live = streamingIdsRef.current;
    if (on) live.add(id);
    else live.delete(id);
    setStreamingIds((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  // 当前活跃会话视角的 streaming —— 旧 UI 契约（Composer 停止按钮等）继续可用。
  const streaming = activeId ? streamingIds.has(activeId) : false;

  // 向胶囊浮岛广播「在场」状态。灵境离开 /aetherhub 后仍挂载（见
  // AetherHubKeepAliveHost），浮岛靠这两个标量显示当前会话与生成进度。
  const setHubPresence = useAetherHubPresenceStore((state) => state.setPresence);
  const resetHubPresence = useAetherHubPresenceStore((state) => state.reset);
  useEffect(() => {
    setHubPresence({
      sessionTitle: activeSession?.title?.trim() || null,
      streamingCount: streamingIds.size,
    });
  }, [activeSession?.title, streamingIds, setHubPresence]);
  useEffect(() => () => resetHubPresence(), [resetHubPresence]);

  // ----- 云同步：本地优先 + 服务端 LWW 漫游（网络细节全部收在 sessionsSync.ts）-----
  // hydrate 已用本地快照即时渲染；这里在后台 GET 列表对账：服务端较新的会话标
  // 懒加载（激活时拉全量），本地较新/仅存本地的标 dirty 待推送（服务端为空时
  // 即首次迁移导入）。对账输入用 localStorage 快照 —— 与其它设备可见的真值一致。
  useEffect(() => {
    if (!hydrated) return;
    configureAgentSessionSync({
      userId: currentUser.id === 'anon' ? null : currentUser.id,
      // 409 冲突 / 懒加载采纳服务端版本 —— 正在流式的会话拒绝采纳（返回
      // false，水位不动），流结束后的下一轮 flush 再冲突再采纳。
      // mergeAdoptedServerSession：保留本地 draft（纯本地态，用户可能正在
      // 输入）与 titleEdited（不在 wire 里）；采纳瞬间本地 updatedAt 已更
      // 新（用户刚做了编辑）→ 返回 null 拒绝采纳，走既有 LWW 重试通道。
      onAdoptServerVersion: (session) => {
        if (streamingIdsRef.current.has(session.id)) return false;
        const local = sessionsRef.current.find((s) => s.id === session.id);
        const merged = mergeAdoptedServerSession(session, local);
        if (merged === null) return false;
        setSessions((prev) =>
          prev.some((s) => s.id === merged.id)
            ? prev.map((s) => (s.id === merged.id ? merged : s))
            : [merged, ...prev],
        );
        return true;
      },
      // 服务端有、本地没有的会话（其他设备创建）→ 以 meta 占位进侧栏。
      onServerOnlySessions: (remote) => {
        setSessions((prev) => {
          const known = new Set(prev.map((s) => s.id));
          const fresh = remote.filter((s) => !known.has(s.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      },
      onSyncNotice: (message) => toast.info(message),
    });
    void reconcileAgentSessions(loadSessions(currentUser.id));
  }, [hydrated, currentUser.id]);

  // 激活会话时检查懒加载 —— 只有 reconcile 标记过「服务端较新」的才真的发 GET。
  useEffect(() => {
    if (!hydrated) return;
    notifyAgentSessionActivated(activeId);
  }, [hydrated, activeId]);

  // ----- 待发送的图片附件（仅随下一条消息发出，切换会话即清空）-----
  const [composerAttachments, setComposerAttachments] = useState<AgentAttachment[]>([]);
  const [selectedArticles, setSelectedArticles] = useState<AgentArticle[]>([]);
  const [selectedTags, setSelectedTags] = useState<AgentTag[]>([]);
  // KB picker：选中的知识库参与本轮对话；按用户对每个 KB 的有效权限（USE+）过滤。
  const [selectedKbs, setSelectedKbs] = useState<AgentKnowledgeBase[]>([]);
  const [selectedAtlasKps, setSelectedAtlasKps] = useState<AtlasKnowledgePoint[]>([]);
  // 自动检索开关：空 picker 默认 = 不检索（none）。打开后才走 auto —— 后端会
  // 注入「当前用户有权限的全部 KB」，代价是每轮都跑一次召回，所以必须是用户
  // 主动选择而不是隐式默认（否则每条无关提问都挂一张「没有命中相关知识」）。
  // 与显式选来源互斥：选了来源就是 selected，后端拒绝 auto 携带显式 id。
  const [autoKnowledge, setAutoKnowledge] = useState(false);
  const [pendingSessionKnowledgeHandoff, setPendingSessionKnowledgeHandoff] =
    useState<SessionKnowledgeHandoff | null>(null);
  const activeSessionKnowledgeHandoff = getSessionKnowledgeHandoff(
    pendingSessionKnowledgeHandoff,
    activeId,
  );
  const pendingKnowledgeHandoff = activeSessionKnowledgeHandoff?.handoff ?? null;
  const clearActiveKnowledgeHandoff = useCallback(() => {
    setPendingSessionKnowledgeHandoff((current) =>
      clearSessionKnowledgeHandoff(current, activeId),
    );
  }, [activeId]);
  // 交接消费的去重键 = 用户 × 本次路由进入。保活实例不重挂载，只按用户去重会
  // 让「先逛过灵境 → 去知识工作台派任务 → 回灵境」这条路彻底失效：一次性任务
  // 留在 storage 里直到过期，用户看不到任何反应。
  const handoffConsumedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    setSelectedArticles([]);
    setSelectedTags([]);
    setSelectedKbs([]);
    setSelectedAtlasKps([]);
    setComposerAttachments([]);
  }, [activeId]);

  useEffect(() => {
    if (!hydrated || currentUser.id === 'anon' || !onRoute) return;
    const consumeKey = `${currentUser.id}:${routeEntryCount}`;
    if (handoffConsumedKeyRef.current === consumeKey) return;
    handoffConsumedKeyRef.current = consumeKey;

    const result = consumeKnowledgeWorkspaceHandoff(currentUser.id);
    if (!result.ok) {
      toast.warning(result.error.message);
      return;
    }
    if (result.status !== 'consumed') return;

    const fresh = withAgentSessionDraft(
      createEmptySession('chat'),
      result.handoff.draftPrompt ?? '',
    );
    setSessions((current) => [fresh, ...current]);
    setActiveId(fresh.id);
    setPendingSessionKnowledgeHandoff({ sessionId: fresh.id, handoff: result.handoff });
    const sourceCount =
      result.handoff.context.mode === 'selected' ? result.handoff.context.refs.length : 0;
    toast.success(
      result.handoff.context.mode === 'selected'
        ? `已带入工作台任务与 ${sourceCount} 个指定来源`
        : result.handoff.context.mode === 'none'
          ? '已带入工作台任务，本次不使用知识来源'
          : '已带入工作台任务，将自动检索有权限的知识库与知识点',
    );
  }, [currentUser.id, hydrated, onRoute, routeEntryCount]);

  // ----- 侧栏与右侧上下文面板：收起 / 展开 -----
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [mobileSessionOpen, setMobileSessionOpen] = useState(false);
  const [mobileConfigOpen, setMobileConfigOpen] = useState(false);

  // ----- 显示模式：bubble（气泡） vs engraved（版书）-----
  // 版书模式下，user/agent 标识行变成居中浮动分隔线，正文以"凸起浮印"质感渲染。
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bubble');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('aetherblog.admin.aetherhub.displayMode');
    if (stored === 'engraved' || stored === 'bubble') setDisplayMode(stored);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.admin.aetherhub.displayMode', displayMode);
  }, [displayMode]);

  // ----- 流式吐字动画：none / fade / smooth -----
  const [streamAnimation, setStreamAnimation] = useState<StreamAnimationMode>('smooth');
  // rAF 管线在闭包外读当前档位（切档立即生效，不需要重启流）。
  const streamAnimationRef = useRef<StreamAnimationMode>(streamAnimation);
  useEffect(() => {
    streamAnimationRef.current = streamAnimation;
  }, [streamAnimation]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('aetherblog.admin.aetherhub.streamAnimation');
    if (stored === 'none' || stored === 'fade' || stored === 'smooth') setStreamAnimation(stored);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.admin.aetherhub.streamAnimation', streamAnimation);
  }, [streamAnimation]);

  // ----- 字体大小：13-17px，默认 14.5（与文章详情正文同档） -----
  const [fontSize, setFontSize] = useState<number>(14.5);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('aetherblog.admin.aetherhub.fontSize');
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n >= 12 && n <= 20) setFontSize(n);
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('aetherblog.admin.aetherhub.fontSize', String(fontSize));
  }, [fontSize]);

  // ----- 发送触发方式：可配置的发送键位。 -----
  const [sendShortcut, setSendShortcut] = useState<SendShortcut>(() => readSendShortcut());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, sendShortcut);
  }, [sendShortcut]);

  // ----- 工具调用开关：开启且当前模型声明 functionCall 能力时随请求上行。 -----
  const [enableTools, setEnableTools] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(ENABLE_TOOLS_STORAGE_KEY) === '1') setEnableTools(true);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ENABLE_TOOLS_STORAGE_KEY, enableTools ? '1' : '0');
  }, [enableTools]);

  // 新建 / 切换会话不再被生成中的流阻塞 —— 旧流在自己的会话里继续写，
  // 由闭包 pin 住的 sessionId 保证不串台。
  const handleNewSession = useCallback(() => {
    const fresh = createEmptySession('chat');
    setSessions((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
  }, []);

  // 侧栏「当前对话配置」入口按视口分流：紧凑视口给底部配置抽屉（字号 / 快捷
  // 操作只在这里），桌面给右侧空间与参数面板。历史版本从未打开过配置抽屉，
  // 字号调节等能力因此完全不可达。
  const isCompactViewport = useMediaQuery('(max-width: 1279px)');
  const handleOpenCurrentConfig = useCallback(() => {
    if (isCompactViewport) {
      setMobileConfigOpen(true);
      return;
    }
    setPanelCollapsed(false);
    setMobileConfigOpen(false);
  }, [isCompactViewport]);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === activeId) return;
      setActiveId(id);
    },
    [activeId],
  );

  // 附件原图 best-effort 回收（内存缓存 + IndexedDB）—— 失败静默。分支会话
  // 与原会话共享附件 id，无条件回收会连坐另一方的图片：先对「变更后的全部
  // 会话」做引用计数，仅回收不再被任何存活消息引用的。删会话 / 删消息截断 /
  // 编辑截断 / 清空消息四类入口统一走这里。
  const reclaimAttachments = useCallback(
    (candidateIds: readonly string[], sessionsAfterChange: readonly AgentSession[]) => {
      const ids = collectReclaimableAttachmentIds(candidateIds, sessionsAfterChange);
      if (ids.length === 0) return;
      ids.forEach(dropAttachmentCache);
      void deleteAttachmentData(ids);
    },
    [],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      // 删除正在流式的会话前先掐断它的流，避免 rAF 管线继续往已删除的
      // 会话里写（map 找不到目标只是空转，但计时器与网络流会白跑）。
      const controller = abortControllersRef.current.get(id);
      if (controller) {
        controller.abort();
        abortControllersRef.current.delete(id);
        markStreaming(id, false);
      }
      setPendingSessionKnowledgeHandoff((current) =>
        clearSessionKnowledgeHandoff(current, id),
      );
      // 云端镜像同删 —— fire-and-forget，404 / 网络失败忽略（本地优先）。
      deleteAgentSessionRemote(id);
      const doomed = sessionsRef.current.find((s) => s.id === id);
      if (doomed) {
        reclaimAttachments(
          collectAttachmentIds(doomed.messages),
          sessionsRef.current.filter((s) => s.id !== id),
        );
      }
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          const fresh = createEmptySession('chat');
          setActiveId(fresh.id);
          return [fresh];
        }
        if (id === activeId) {
          const nextActiveId = next.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
          setActiveId(nextActiveId);
        }
        return next;
      });
      toast.success('对话已删除');
    },
    [activeId, markStreaming, reclaimAttachments],
  );

  // 置顶 / 重命名有意不 bump updatedAt（沿用既有行为，见 sessionsSync 头注释），
  // 因此不参与 LWW 竞争、也不会阻塞 flush —— 走 updateSession 而不是门禁版本，
  // 免得用户在等云端加载时连侧栏整理都做不了。
  const handleTogglePinSession = useCallback(
    (id: string) => {
      updateSession(id, (s) => ({ ...s, pinned: !s.pinned }));
    },
    [updateSession],
  );

  const handleRenameSession = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim().slice(0, 60);
      if (!trimmed) return;
      // titleEdited：手动改名后 AI 自动起名不再覆盖（本地字段，不随云同步）。
      updateSession(id, (s) => ({ ...s, title: trimmed, titleEdited: true }));
    },
    [updateSession],
  );

  const handleExportSession = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (!session || session.messages.length === 0) {
        toast.info('这个对话还没有消息，无需导出');
        return;
      }
      const markdown = sessionToMarkdown(session);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFileName(session);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('对话已导出为 Markdown');
    },
    [sessions],
  );

  const handleSetModel = useCallback(
    (modelId: string | null, providerCode: string | null) => {
      if (!activeSession) return;
      mutateSyncedSession(activeSession.id, (s) => ({
        ...s,
        modelId,
        providerCode,
        modelParams: undefined,
        updatedAt: Date.now(),
      }));
    },
    [activeSession, mutateSyncedSession],
  );

  // 模型清单刷新后对账：会话钉着的模型可能刚在 /ai-config 被停用 / 删除，而
  // activeSession.modelId 不会自己失效 —— 下一条消息会原样带上它，换来后端一句
  // 「Requested model not found」。清空 = 回落自动路由，并告诉用户发生了什么。
  // silent 是因为这不是用户主动操作：会话还在等云端懒加载时不该弹门禁 toast，
  // 加载完这个 effect 会因 modelsState / activeSession 变化再跑一次。
  useEffect(() => {
    if (modelsState.status !== 'ready') return;
    const modelId = activeSession?.modelId;
    if (!activeSession || !modelId) return;
    const stillAvailable = modelsState.items.some(
      (m) => m.modelId === modelId && m.providerCode === activeSession.providerCode,
    );
    if (stillAvailable) return;
    const ok = mutateSyncedSession(
      activeSession.id,
      (session) => ({
        ...session,
        modelId: null,
        providerCode: null,
        modelParams: undefined,
        updatedAt: Date.now(),
      }),
      { silent: true },
    );
    if (ok) {
      toast.info(`「${modelId}」已不在可用清单中，本对话已改回自动路由`);
    }
  }, [modelsState, activeSession, mutateSyncedSession]);

  const handleSetModelParam = useCallback(
    (key: string, value: AgentModelParams[string] | undefined) => {
      if (!activeSession) return;
      mutateSyncedSession(activeSession.id, (s) => {
        const nextParams = { ...(s.modelParams || {}) };
        if (value === undefined || value === null || value === '') {
          delete nextParams[key];
        } else {
          nextParams[key] = value;
        }
        return {
          ...s,
          modelParams: cleanModelParams(nextParams),
          updatedAt: Date.now(),
        };
      });
    },
    [activeSession, mutateSyncedSession],
  );

  const handleResetModelParams = useCallback(() => {
    if (!activeSession) return;
    mutateSyncedSession(activeSession.id, (s) => ({
      ...s,
      modelParams: undefined,
      updatedAt: Date.now(),
    }));
  }, [activeSession, mutateSyncedSession]);

  const handleAbort = useCallback(() => {
    const targetId = activeId;
    if (!targetId) return;
    abortControllersRef.current.get(targetId)?.abort();
    abortControllersRef.current.delete(targetId);
    markStreaming(targetId, false);
    // 关键修复：abort 走 AbortError 分支不会触发 onDone/onError，pending 永远不会被
    // 清掉，导致思考状态计时的 100ms tick 一直滚（你看到的 "正在生成 · 1413s"）。
    // 这里手动把"该会话还在 pending 的 assistant 消息"落定到完成态 —— 只处理
    // 当前会话，别的会话可能正有自己的流在跑。
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== targetId
          ? s
          : {
              ...s,
              messages: s.messages.map((m) =>
                m.role === 'assistant' && m.pending
                  ? {
                      ...m,
                      pending: false,
                      finishedAt: Date.now(),
                      error: m.content ? undefined : '已停止生成',
                    }
                  : m,
              ),
            },
      ),
    );
  }, [activeId, markStreaming]);

  // ----- 会话标题 AI 自动生成 -----
  // 首轮问答成功后，后台静默起一条轻量 chat 流（不触发知识检索）为会话起名。
  // 每会话只尝试一次（模块级 attempted 登记），失败静默；写入前后各核对一次
  // 「标题仍是派生值且未被手动改名」，手动重命名永远赢。
  const scheduleAutoTitle = useCallback(
    (sessionId: string, question: string, answer: string) => {
      if (autoTitleAttemptedSessions.has(sessionId)) return;
      autoTitleAttemptedSessions.add(sessionId);
      const derivedTitle = deriveSessionTitle(question);
      const isAutoTitle = (s: AgentSession) =>
        !s.titleEdited && (s.title === derivedTitle || s.title === '新对话');
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current || !isAutoTitle(current)) return;
      let acc = '';
      // 辅助流登记 AbortController —— 页面卸载时一并掐断，完成后自清。
      const controller = new AbortController();
      auxControllersRef.current.add(controller);
      void streamAgentChat(
        {
          sessionId,
          mode: 'chat',
          knowledgeContextMode: 'none',
          kbIds: null,
          messages: [
            {
              role: 'user',
              content:
                '请为以下对话生成一个不超过 16 字的中文标题，只输出标题本身，' +
                '不要引号、句号或任何解释。\n\n' +
                `用户问题：${question.slice(0, 500)}\n\n` +
                `助手回答：${answer.slice(0, 500)}`,
            },
          ],
        },
        {
          onDelta: (chunk) => {
            acc += chunk;
          },
          onDone: () => {
            const title = sanitizeGeneratedSessionTitle(acc);
            if (!title) return;
            // 生成期间用户可能已手动改名 / 删除会话 —— updater 内再核对一次，
            // 不满足即放弃（updateSession 对不存在的会话本身就是 no-op）。
            // 走门禁的静默档：起名同样 bump updatedAt，但它是后台任务，被懒加载
            // 拦下时不该弹 toast 打扰用户 —— 丢掉这次起名即可（best-effort）。
            mutateSyncedSession(
              sessionId,
              (s) => (isAutoTitle(s) ? { ...s, title, updatedAt: Date.now() } : s),
              { silent: true },
            );
          },
          onError: () => undefined, // 静默：起名失败不打扰用户，也不重试
        },
        controller.signal,
      )
        .catch(() => undefined)
        .finally(() => auxControllersRef.current.delete(controller));
    },
    [mutateSyncedSession],
  );

  const handleSend = useCallback(
    async (
      rawText: string,
      override?: {
        session: AgentSession;
        messages: AgentMessage[];
        requestSnapshot?: AgentRequestSnapshotV1;
        handoffSnapshot?: SessionKnowledgeHandoff | null;
      },
    ) => {
      const text = rawText.trim();
      const baseSession = override?.session ?? activeSession;
      const baseMessages = override?.messages ?? baseSession?.messages ?? [];
      if (!text || !baseSession) return;
      // 只挡「同一会话并发两条流」，不再全局冻结 —— 其他会话照常可发。
      if (streamingIdsRef.current.has(baseSession.id)) {
        toast.info('这个对话正在生成回答，请先停止或稍候');
        return;
      }
      // 会话仍在等待云端懒加载（本地只是空壳/旧壳占位，不是权威版本）：
      // 此刻发消息会以更晚的 updatedAt 通过 LWW 把服务端全量历史覆盖掉 ——
      // 拦下并触发一次懒加载重试（细节见 ensureSessionHydrated），加载完成后再发。
      // 必须在任何副作用（附件落盘 / 清空 composer）之前拦。
      if (!ensureSessionHydrated(baseSession.id)) return;

      // 会话钉了模型时，清单没核对完就不发 —— 自动路由不依赖清单，不拦。
      // 放在这里而不是输入框：重试卡、/regen、编辑重放都直接进 handleSend。
      if (baseSession.modelId && isModelCatalogRevalidating(modelsState)) {
        toast.info('正在核对模型清单，请稍候再发送');
        return;
      }

      const isFirstMessage = baseMessages.length === 0;
      const sessionId = baseSession.id;
      const modelId = baseSession.modelId ?? null;
      const providerCode = baseSession.providerCode ?? null;
      const requestModel = currentModelFromSession(baseSession, modelsState);
      const modelParams = buildModelParamsForRequest(requestModel, baseSession.modelParams);
      // 工具调用双重门控：开关开启且当前模型显式声明 functionCall 才上行
      // enableTools（自动路由 / 能力未知一律不带；服务端同样会静默降级）。
      const toolsEnabled = enableTools && requestModel?.abilities?.functionCall === true;

      // 图片附件只随手动发送走（重试 / 编辑重放不重复携带），且必须有
      // 明确声明 vision 能力的模型 —— 自动路由不知道会落到谁，直接拦下。
      const requestAttachments = override ? [] : composerAttachments;
      if (requestAttachments.length > 0 && !requestModel?.abilities?.vision) {
        toast.error(
          requestModel
            ? '当前模型不支持图片输入，请换一个带「视觉」能力的模型'
            : '发送图片前请先在模型选择器中指定一个支持视觉能力的模型',
        );
        return;
      }
      const replaySnapshot = override?.requestSnapshot ?? null;
      const requestArticles = replaySnapshot ? [] : selectedArticles;
      const requestTags = replaySnapshot ? [] : selectedTags;
      const requestKbs = replaySnapshot ? [] : selectedKbs;
      const requestAtlasKps = replaySnapshot ? [] : selectedAtlasKps;
      const requestSessionHandoff = getSessionKnowledgeHandoff(
        pendingSessionKnowledgeHandoff,
        baseSession.id,
      );
      const requestKnowledgeContext = replaySnapshot
        ? replaySnapshot.knowledgeContext
        : selectAetherHubKnowledgeContext(
            requestSessionHandoff?.handoff.context ?? null,
            requestKbs,
            requestAtlasKps,
            autoKnowledge,
          );
      const requestHandoffSnapshot =
        override?.handoffSnapshot ?? (replaySnapshot ? null : requestSessionHandoff);
      const contextPayload = resolveAetherHubKnowledgeContext(
        requestKnowledgeContext,
        [],
        [],
      );
      if (!contextPayload.ok) {
        toast.error(contextPayload.error.message);
        return;
      }
      const requestSnapshot = createAetherHubRequestSnapshot(
        requestKnowledgeContext,
        replaySnapshot?.articleIds ?? requestArticles.map((article) => article.id),
        replaySnapshot?.tagSlugs ?? requestTags.map((tag) => tag.slug),
      );
      const now = Date.now();
      const userMsg: AgentMessage = {
        id: newMessageId(),
        role: 'user',
        content: text,
        requestSnapshot,
        createdAt: now,
        // 原图只进内存缓存（localStorage 5MB 配额装不下 base64 原图）；
        // 会话里存的是去掉 dataUrl 的元信息，刷新后降级为占位卡片。
        attachments:
          requestAttachments.length > 0
            ? requestAttachments.map((a) => {
                writeAttachmentCache(a.id, a.dataUrl);
                // 原图同时异步落 IndexedDB —— 刷新 / 重启后仍可显示；写入失败
                // 静默（隐私模式等场景退回「仅发送当次可见」的占位卡）。
                void putAttachmentData(a.id, a.dataUrl);
                return { ...a, dataUrl: '' };
              })
            : undefined,
      };
      const assistantId = newMessageId();
      const assistantMsg: AgentMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now,
        startedAt: now,
        pending: true,
        // 模型戳记：这条回复实际请求的模型（null = 后端自动路由），供元数据
        // footer 展示与「重试时换模型」参考。
        modelId,
        providerCode,
      };

      // 上下文断点之前的消息不随请求发送（消息保留可回看）；随后按后端硬限
      // （单条 8000 / 总 32000 / 64 条）做预算裁剪 —— 旧版全量发送，长会话
      // 必然 413，用户只能清空自救。
      const contextMessages = sliceContextMessages(baseMessages, baseSession.contextBreakId);
      const budget = budgetHistory([
        ...contextMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: text },
      ]);
      if (budget.droppedMessages > 0) {
        toast.info(`上下文较长，已省略最早的 ${budget.droppedMessages} 条消息`, {
          id: `budget-${sessionId}`,
        });
      }
      const historyForRequest: ChatStreamRequest['messages'] = budget.history.map((m, idx) =>
        idx === budget.history.length - 1 && requestAttachments.length > 0
          ? {
              role: m.role,
              content: [
                ...(m.content ? ([{ type: 'text', text: m.content }] as const) : []),
                ...requestAttachments.map(
                  (a) => ({ type: 'image_url', image_url: { url: a.dataUrl } }) as const,
                ),
              ],
            }
          : m,
      );

      // 直接 updateSession（不再过门禁）：本函数入口已经过一次 ensureSessionHydrated，
      // 且这一步之后就进流式管线 —— 中途再拦只会写出半条消息。
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [...baseMessages, userMsg, assistantMsg],
        title: isFirstMessage ? deriveSessionTitle(text) : s.title,
        draft: resolveAgentSessionDraftAfterRequestStart(s, Boolean(override)),
        updatedAt: now,
      }));
      if (!override) setComposerAttachments([]);
      const clearRequestContext = () => {
        const sentKnowledgeBaseIds =
          requestSnapshot.knowledgeContext.mode === 'selected'
            ? requestSnapshot.knowledgeContext.refs
                .filter((ref) => ref.kind === 'knowledge-base')
                .map((ref) => ref.id)
            : [];
        const sentKnowledgePointIds =
          requestSnapshot.knowledgeContext.mode === 'selected'
            ? requestSnapshot.knowledgeContext.refs
                .filter((ref) => ref.kind === 'atlas-kp')
                .map((ref) => ref.id)
            : [];
        setSelectedArticles((current) =>
          preserveContextSelectionKeysAfterSuccess(
            current,
            requestSnapshot.articleIds ?? [],
            (article) => article.id,
          ),
        );
        setSelectedTags((current) =>
          preserveContextSelectionKeysAfterSuccess(
            current,
            requestSnapshot.tagSlugs ?? [],
            (tag) => tag.slug,
          ),
        );
        setSelectedKbs((current) =>
          preserveContextSelectionKeysAfterSuccess(
            current,
            sentKnowledgeBaseIds,
            (knowledgeBase) => knowledgeBase.id,
          ),
        );
        setSelectedAtlasKps((current) =>
          preserveContextSelectionKeysAfterSuccess(
            current,
            sentKnowledgePointIds,
            (knowledgePoint) => knowledgePoint.id,
          ),
        );
        setPendingSessionKnowledgeHandoff((current) =>
          preserveSessionKnowledgeHandoffAfterSuccess(current, requestHandoffSnapshot),
        );
      };
      markStreaming(sessionId, true);

      const controller = new AbortController();
      abortControllersRef.current.set(sessionId, controller);

      const patchAssistant = (patch: Partial<AgentMessage>) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id !== sessionId
              ? s
              : {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantId ? { ...m, ...patch } : m,
                  ),
                  updatedAt: Date.now(),
                },
          ),
        );
      };

      // === 流式累加 + rAF 平滑显示（唯一管线） ===
      // MessageRow 直接渲染 message.content，气泡内不再二次节流。历史版本在
      // 这条管线之外，AssistantContent 里又叠了一层 useSmoothStream（固定
      // 45 chars/s），两个 typewriter 互相竞争：实际可见速率被钉死在 45 字/秒，
      // 长回答 lag 滚雪球，流结束瞬间整段瞬移 —— 这正是「卡顿 + 内容跳变」的
      // 根因。单管线后速率自适应、终态平滑收尾（平移自 blog 端已验证实现）。
      let acc = '';                                // server 正文累加
      let thinkAcc = '';                           // server 思考段累加
      let displayed = '';                          // UI 实际显示的正文
      let displayedThink = '';                     // UI 实际显示的思考段
      let firstTokenAt: number | null = null;
      let streamDone = false;                      // server 已发 done/error
      let finalPatch: Partial<AgentMessage> | null = null;
      let pendingMisc: Partial<AgentMessage> = {}; // sources/retrieval/usage 等待写
      let rafId = 0;
      let lastPaintAt = 0;                         // 长文降帧的上次提交时间

      // stride —— lag 越大追得越激进；流结束后再加速一档，收尾利落不拖沓。
      const computeStride = (lag: number, finishing: boolean): number => {
        if (finishing) return Math.max(8, Math.ceil(lag / 5));
        if (lag > 600) return Math.ceil(lag / 12);
        if (lag > 200) return Math.ceil(lag / 18);
        if (lag > 60) return 5;
        if (lag > 20) return 3;
        return 2;
      };

      // 长内容降帧：每帧 setState 都会让流式渲染器全量重 parse（O(文档长度)），
      // 60fps × 长文档 = 主线程被 parse 吃满。按长度把提交频率降到 ~30/20fps，
      // 阅读节奏无感知，CPU 直接砍半以上。
      const minPaintInterval = (len: number): number => {
        if (len > 6000) return 48; // ~20fps
        if (len > 2500) return 32; // ~30fps
        return 0;
      };

      const tick = () => {
        rafId = 0;

        const nowTs = performance.now();
        const interval = minPaintInterval(acc.length);
        if (interval > 0 && nowTs - lastPaintAt < interval && displayed.length < acc.length) {
          rafId = requestAnimationFrame(tick);
          return;
        }
        lastPaintAt = nowTs;

        // 推进 displayed —— '无动画'档直接对齐，其余按 stride 匀速追赶。
        // 思考段与正文共享同一帧提交，但各自独立追进度。
        if (streamAnimationRef.current === 'none') {
          displayed = acc;
          displayedThink = thinkAcc;
        } else {
          if (displayed.length < acc.length) {
            const lag = acc.length - displayed.length;
            displayed = acc.slice(0, Math.min(displayed.length + computeStride(lag, streamDone), acc.length));
          }
          if (displayedThink.length < thinkAcc.length) {
            const lag = thinkAcc.length - displayedThink.length;
            displayedThink = thinkAcc.slice(
              0,
              Math.min(displayedThink.length + computeStride(lag, streamDone), thinkAcc.length),
            );
          }
        }

        const patch: Partial<AgentMessage> = { content: displayed };
        if (displayedThink) patch.think = displayedThink;
        if (Object.keys(pendingMisc).length > 0) {
          Object.assign(patch, pendingMisc);
          pendingMisc = {};
        }

        // 仅当目标消息仍在 pending 才写入 —— 防止 abort 已落定 pending:false
        // 后又被本帧覆盖回流式状态。
        setSessions((prev) =>
          prev.map((s) =>
            s.id !== sessionId
              ? s
              : {
                  ...s,
                  updatedAt: Date.now(),
                  messages: s.messages.map((m) =>
                    m.id === assistantId && m.pending ? { ...m, ...patch } : m,
                  ),
                },
          ),
        );

        const caughtUp = displayed.length >= acc.length && displayedThink.length >= thinkAcc.length;
        if (!caughtUp) {
          rafId = requestAnimationFrame(tick);
        } else if (streamDone && finalPatch) {
          // 显示追平 + 流已结束 → 应用终态（content/think 用累加值兜底，保证完整）
          const fp = finalPatch;
          finalPatch = null;
          setSessions((prev) =>
            prev.map((s) =>
              s.id !== sessionId
                ? s
                : {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantId && m.pending
                        ? { ...m, ...fp, content: acc, think: thinkAcc || m.think }
                        : m,
                    ),
                  },
            ),
          );
        }
        // else：已追平但流未结束 → 等下一个 onDelta 再唤醒
      };

      const schedule = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(tick);
      };
      const finishStream = (patch: Partial<AgentMessage>) => {
        streamDone = true;
        finalPatch = patch;
        schedule();
      };

      const auditMatch = text.match(/^\/audit\s+(\d+)\s*$/i);
      if (auditMatch) {
        try {
          const published = await agentWorkflowService.listPublished(100);
          const audit = published.data?.find((item) => item.slug === 'article-audit' || item.slug === 'article-audit-agent');
          if (!audit) {
            throw new Error('Article Audit 工作流尚未发布');
          }
          const run = await agentWorkflowService.invokePublished(audit.slug, { post_id: Number(auditMatch[1]) });
          patchAssistant({
            content: `已启动 Article Audit 工作流：#${run.data?.id || '-'}，状态 ${run.data?.status || 'pending'}。`,
            pending: false,
            finishedAt: Date.now(),
          });
          clearRequestContext();
        } catch (error: unknown) {
          // error 是直接渲染给用户的那一行（"ERROR · {message.error}"），只放人话；
          // 内部码走 errorCode（与流式失败路径 onError 的 message/meta.code 分工一致）。
          patchAssistant({
            pending: false,
            error: workflowErrorMessage(error, 'Article Audit 启动失败'),
            errorCode: 'workflow_invoke_failed',
            retryable: true,
            finishedAt: Date.now(),
          });
        } finally {
          markStreaming(sessionId, false);
          abortControllersRef.current.delete(sessionId);
        }
        return;
      }

      const req: ChatStreamRequest = {
        sessionId,
        mode: 'chat',
        messages: historyForRequest,
        modelId,
        providerCode,
        modelParams,
        articleIds: requestSnapshot.articleIds,
        tagSlugs: requestSnapshot.tagSlugs,
        ...(toolsEnabled ? { enableTools: true } : {}),
        ...contextPayload.value,
      };
      let retrievalReceipt: AgentRetrievalReceipt | null = null;

      try {
        await streamAgentChat(
          req,
          {
            onDelta: (chunk) => {
              acc += chunk;
              if (firstTokenAt == null) {
                firstTokenAt = Date.now();
                pendingMisc.firstTokenAt = firstTokenAt;
              }
              schedule();
            },
            onThink: (chunk) => {
              thinkAcc += chunk;
              schedule();
            },
            onSources: (sources) => {
              pendingMisc.sources = sources;
              schedule();
            },
            onRetrieval: (receipt) => {
              retrievalReceipt = receipt;
              // 回执在正文前一次性到达 —— 直接落消息，不等吐字管线。
              patchAssistant({ retrieval: receipt });
            },
            // 工具事件不走吐字 rAF 管线 —— 在轮次间隙到达、频率低（≤4 轮），
            // 直接函数式 patch 目标 assistant 消息的 toolEvents。
            onToolCall: (call) => {
              const startedAt = Date.now();
              setSessions((prev) =>
                prev.map((s) =>
                  s.id !== sessionId
                    ? s
                    : {
                        ...s,
                        updatedAt: startedAt,
                        messages: s.messages.map((m) => {
                          if (m.id !== assistantId) return m;
                          const events = m.toolEvents ?? [];
                          // 同 id 去重（服务端异常重发时以首个为准）。
                          if (events.some((e) => e.id === call.id)) return m;
                          const event: AgentToolEvent = {
                            id: call.id,
                            name: call.name,
                            arguments: call.arguments,
                            startedAt,
                          };
                          return { ...m, toolEvents: [...events, event] };
                        }),
                      },
                ),
              );
            },
            onToolResult: (result) => {
              const finishedAt = Date.now();
              setSessions((prev) =>
                prev.map((s) =>
                  s.id !== sessionId
                    ? s
                    : {
                        ...s,
                        updatedAt: finishedAt,
                        messages: s.messages.map((m) => {
                          if (m.id !== assistantId) return m;
                          const events = m.toolEvents ?? [];
                          // 协议保证 result 前必有同 id 的 call；万一缺失则以
                          // result 自建条目兜底（不丢可见信息）。
                          if (!events.some((e) => e.id === result.id)) {
                            const orphan: AgentToolEvent = {
                              id: result.id,
                              name: result.name,
                              arguments: '',
                              result: result.result,
                              isError: result.isError,
                              startedAt: finishedAt,
                              finishedAt,
                            };
                            return { ...m, toolEvents: [...events, orphan] };
                          }
                          return {
                            ...m,
                            toolEvents: events.map((e) =>
                              e.id === result.id
                                ? {
                                    ...e,
                                    result: result.result,
                                    isError: result.isError,
                                    finishedAt,
                                  }
                                : e,
                            ),
                          };
                        }),
                      },
                ),
              );
            },
            onUsage: (usage) => {
              pendingMisc.usage = usage;
              schedule();
            },
            onDone: () => {
              const citationCount =
                retrievalReceipt?.hits.filter((hit) => hit.kind !== 'knowledge_base_chunk').length ??
                0;
              void atlasService.recordEvent({
                eventType: 'atlas.aetherhub_atlas_answer',
                title: 'AetherHub Atlas answer',
                description: `${describeAetherHubAtlasScope(contextPayload.value.atlasScope?.kpIds ?? [])}; citation_count=${citationCount}; retrieval_status=${retrievalReceipt?.status ?? 'not_requested'}`,
                status: retrievalReceipt?.status === 'matched' ? 'SUCCESS' : 'WARNING',
              }).catch(() => undefined);
              finishStream({ pending: false, finishedAt: Date.now() });
              clearRequestContext();
              // 首轮问答成功（会话恰为 [user, assistant] 且回答非空）→ 后台
              // 静默生成会话标题。闭包 pin 的是 sessionId 而非 activeSession，
              // 用户切走会话也不会串台。
              if (isFirstMessage && acc.trim()) {
                scheduleAutoTitle(sessionId, text, acc);
              }
            },
            onError: (message, meta) =>
              finishStream({
                pending: false,
                error: message,
                errorCode: meta?.code,
                retryable: meta?.retryable,
                finishedAt: Date.now(),
              }),
          },
          controller.signal,
        );
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          finishStream({
            pending: false,
            error: err instanceof Error ? err.message : '请求失败',
            retryable: true,
            finishedAt: Date.now(),
          });
        } else if (rafId) {
          // abort：handleAbort 已把消息落定，掐掉还在排队的帧防止覆盖。
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } finally {
        if (abortControllersRef.current.get(sessionId) === controller) {
          abortControllersRef.current.delete(sessionId);
        }
        markStreaming(sessionId, false);
      }
    },
    [
      activeSession,
      autoKnowledge,
      composerAttachments,
      enableTools,
      ensureSessionHydrated,
      markStreaming,
      modelsState,
      pendingSessionKnowledgeHandoff,
      scheduleAutoTitle,
      selectedArticles,
      selectedAtlasKps,
      selectedKbs,
      selectedTags,
      updateSession,
    ],
  );

  // 编辑 = 回填输入框 + 截断该消息之后的所有回复。截断不可逆，先过
  // ConfirmModal（浏览器原生 confirm 是设计系统红线）。
  const [confirmEditTarget, setConfirmEditTarget] = useState<AgentMessage | null>(null);
  const applyEditMessage = useCallback(
    (message: AgentMessage) => {
      if (!activeSession) return;
      const idx = activeSession.messages.findIndex((m) => m.id === message.id);
      if (idx < 0) return;
      // 门禁前置到副作用之前：附件回收是不可逆的，不能先删图再被门禁拦下。
      if (!ensureSessionHydrated(activeSession.id)) return;
      // 截断掉的消息（该条及之后）携带的附件：引用计数后 best-effort 回收。
      const remaining = activeSession.messages.slice(0, idx);
      reclaimAttachments(
        collectAttachmentIds(activeSession.messages.slice(idx)),
        sessionsRef.current.map((s) =>
          s.id === activeSession.id ? { ...s, messages: remaining } : s,
        ),
      );
      mutateSyncedSession(activeSession.id, (s) => {
        const nextMessages = s.messages.slice(0, idx);
        return {
          ...s,
          messages: nextMessages,
          contextBreakId: normalizeContextBreak(nextMessages, s.contextBreakId),
          draft: message.content,
          updatedAt: Date.now(),
        };
      });
    },
    [activeSession, ensureSessionHydrated, mutateSyncedSession, reclaimAttachments],
  );
  const handleEditMessage = useCallback(
    (message: AgentMessage) => {
      if (streaming || message.role !== 'user' || !activeSession) return;
      const idx = activeSession.messages.findIndex((m) => m.id === message.id);
      if (idx < 0) return;
      if (activeSession.messages.length > idx + 1) {
        setConfirmEditTarget(message);
        return;
      }
      applyEditMessage(message);
    },
    [activeSession, applyEditMessage, streaming],
  );

  // 翻译 —— 复用 /agent/chat（knowledgeContextMode:'none' 不触发检索），流式
  // 写进 message.translation。再点一次已完成的翻译 = 收起。
  const handleTranslateMessage = useCallback(
    (message: AgentMessage) => {
      if (!activeSession) return;
      const sessionId = activeSession.id;
      const source = message.content;
      if (!source.trim()) return;
      const existing = activeSession.messages.find((m) => m.id === message.id)?.translation;
      if (existing?.pending) return;
      const writeTranslation = (t: AgentTranslation | undefined) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id !== sessionId
              ? s
              : {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id !== message.id ? m : { ...m, translation: t },
                  ),
                },
          ),
        );
      };
      if (existing && !existing.error && existing.content) {
        writeTranslation(undefined);
        return;
      }
      // 目标语言按源文本主导语种取反：CJK 占比超过 1/4 → 译英，否则译中。
      const cjkCount = source.match(/[一-鿿]/g)?.length ?? 0;
      const lang: 'en' | 'zh' = cjkCount > source.length / 4 ? 'en' : 'zh';
      writeTranslation({ lang, content: '', pending: true });
      let acc = '';
      // 辅助流登记 AbortController —— 页面卸载时一并掐断，完成/失败后自清。
      const controller = new AbortController();
      auxControllersRef.current.add(controller);
      void streamAgentChat(
        {
          sessionId,
          mode: 'chat',
          knowledgeContextMode: 'none',
          kbIds: null,
          messages: [
            {
              role: 'user',
              content:
                lang === 'en'
                  ? `Translate the following content into natural, fluent English. Preserve the Markdown structure and keep code blocks unchanged. Output only the translation.\n\n${source}`
                  : `把下面的内容翻译成自然流畅的中文。保留 Markdown 结构，代码块原样不动。只输出译文。\n\n${source}`,
            },
          ],
        },
        {
          onDelta: (chunk) => {
            acc += chunk;
            writeTranslation({ lang, content: acc, pending: true });
          },
          onDone: () => writeTranslation({ lang, content: acc, pending: false }),
          onError: (msg) =>
            writeTranslation({ lang, content: acc, pending: false, error: msg }),
        },
        controller.signal,
      )
        .catch((err) => {
          // 卸载 abort 走 AbortError：不再写状态（残留的 pending 翻译由
          // loadSessions 的加载期收敛统一定格为「翻译已中断」）。
          if ((err as { name?: string })?.name !== 'AbortError') {
            writeTranslation({ lang, content: acc, pending: false, error: '翻译请求失败' });
          }
        })
        .finally(() => auxControllersRef.current.delete(controller));
    },
    [activeSession],
  );

  // 引用 —— 把消息以 Markdown 引用块追加到输入框。
  const handleQuoteMessage = useCallback(
    (message: AgentMessage) => {
      if (!activeSession) return;
      const quoted = message.content
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      const draft = readAgentSessionDraft(activeSession);
      setComposer(draft.trim() ? `${draft.replace(/\s+$/, '')}\n\n${quoted}\n\n` : `${quoted}\n\n`);
      toast.success('已引用到输入框');
    },
    [activeSession, setComposer],
  );

  // 分支 —— 以该消息（含）为止复制出一个新会话，模型与参数随行。
  const handleForkMessage = useCallback(
    (message: AgentMessage) => {
      if (!activeSession) return;
      const idx = activeSession.messages.findIndex((m) => m.id === message.id);
      if (idx < 0) return;
      const fresh: AgentSession = {
        ...createEmptySession(activeSession.mode),
        title: `${activeSession.title || '对话'} · 分支`,
        modelId: activeSession.modelId ?? null,
        providerCode: activeSession.providerCode ?? null,
        modelParams: activeSession.modelParams,
        messages: activeSession.messages
          .slice(0, idx + 1)
          .map((m) => ({ ...m, pending: false })),
      };
      setSessions((prev) => [fresh, ...prev]);
      setActiveId(fresh.id);
      toast.success('已从此处创建分支对话');
    },
    [activeSession],
  );

  // 上下文断点 —— Cherry Studio「清除上下文」心智：断点前的消息保留可回看，
  // 但不再随请求发送；再点一次（或点分隔线上的恢复）即撤销。
  // 同样不 bump updatedAt（纯本地视图态），故不过懒加载门禁。
  const handleToggleContextBreak = useCallback(() => {
    if (!activeSession || activeSession.messages.length === 0) return;
    const lastId = activeSession.messages[activeSession.messages.length - 1].id;
    const clearing = activeSession.contextBreakId === lastId;
    updateSession(activeSession.id, (s) => ({
      ...s,
      contextBreakId: clearing ? null : lastId,
    }));
    toast.success(clearing ? '已恢复完整上下文' : '已清除上下文（消息保留，可随时恢复）');
  }, [activeSession, updateSession]);
  const handleClearContextBreak = useCallback(() => {
    if (!activeSession) return;
    updateSession(activeSession.id, (s) => ({ ...s, contextBreakId: null }));
    toast.success('已恢复完整上下文');
  }, [activeSession, updateSession]);

  // 图片附件：选择 / 粘贴 / 拖入统一走这里，校验类型与体积后转 dataURL。
  const handleAddAttachments = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const room = MAX_IMAGES_PER_MESSAGE - composerAttachments.length;
      if (room <= 0) {
        toast.info(`每条消息最多携带 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
        return;
      }
      const accepted: AgentAttachment[] = [];
      for (const file of files.slice(0, room)) {
        // 超过 5MB 先尝试 canvas 降采样（最长边 2048 / 质量 0.85；GIF 旁路防
        // 丢帧），压后仍超限或压不了才交给原有校验拒绝。
        const candidate = await compressImageIfNeeded(file);
        const problem = validateImageFile(candidate);
        if (problem) {
          toast.error(problem);
          continue;
        }
        try {
          const attachment = await fileToAttachment(candidate);
          // 总量预算：Go 侧 body 上限 24MB ≈ 3 张满额图，前端用 16MB dataURL
          // 预算提前拦截，避免用户攒满 4 张后收到不透明的「请求体过大」。
          if (!attachmentsWithinBudget([...composerAttachments, ...accepted], attachment)) {
            toast.error(`图片总体积超出预算（约 ${Math.round(MAX_TOTAL_ATTACHMENT_DATAURL_BYTES / 1024 / 1024)}MB），请压缩或减少图片`);
            continue;
          }
          accepted.push(attachment);
        } catch {
          toast.error(`读取「${file.name}」失败，请重试`);
        }
      }
      if (files.length > room) {
        toast.info(`每条消息最多携带 ${MAX_IMAGES_PER_MESSAGE} 张图片，多余的已忽略`);
      }
      if (accepted.length > 0) {
        setComposerAttachments((prev) => [...prev, ...accepted]);
      }
    },
    [composerAttachments.length],
  );
  const handleRemoveAttachment = useCallback((id: string) => {
    setComposerAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const retryUserTurn = useCallback(
    (prior: AgentMessage, baseMessages: AgentMessage[], session: AgentSession) => {
      const snapshotResult = readAetherHubRequestSnapshot(prior);
      if (snapshotResult.status === 'invalid') {
        toast.error(snapshotResult.message);
        return;
      }
      void handleSend(prior.content, {
        session: { ...session, messages: baseMessages },
        messages: baseMessages,
        // 快照缺失（快照机制之前存下的旧消息）时退回 auto 契约，与对比路径同款。
        // 不能落到「当前 picker + autoKnowledge」那条路：默认知识范围已是 none，
        // 会把当年靠自动召回作答的历史问题静默改成不检索重放。
        requestSnapshot:
          snapshotResult.status === 'valid'
            ? snapshotResult.snapshot
            : {
                schemaVersion: 1,
                knowledgeContext: { mode: 'auto' },
                articleIds: null,
                tagSlugs: null,
              },
        handoffSnapshot: activeSessionKnowledgeHandoff,
      });
    },
    [activeSessionKnowledgeHandoff, handleSend],
  );

  const handleRetryMessage = useCallback(
    (message: AgentMessage) => {
      if (streaming || message.role !== 'assistant' || !activeSession) return;
      const idx = activeSession.messages.findIndex((m) => m.id === message.id);
      if (idx <= 0) return;
      const prior = activeSession.messages[idx - 1];
      if (prior.role !== 'user') return;
      const baseMessages = activeSession.messages.slice(0, idx - 1);
      retryUserTurn(prior, baseMessages, activeSession);
    },
    [activeSession, retryUserTurn, streaming],
  );

  // 「改用自动检索重试」—— selected 模式 0 命中被拒（selected_context_not_grounded）
  // 时的定向出路：同一问题换 auto 契约重放，让后端自动发现有权限的知识来源。
  const handleRetryMessageAuto = useCallback(
    (message: AgentMessage) => {
      if (streaming || message.role !== 'assistant' || !activeSession) return;
      const idx = activeSession.messages.findIndex((m) => m.id === message.id);
      if (idx <= 0) return;
      const prior = activeSession.messages[idx - 1];
      if (prior.role !== 'user') return;
      const baseMessages = activeSession.messages.slice(0, idx - 1);
      void handleSend(prior.content, {
        session: { ...activeSession, messages: baseMessages },
        messages: baseMessages,
        requestSnapshot: {
          schemaVersion: 1,
          knowledgeContext: { mode: 'auto' },
          articleIds: null,
          tagSlugs: null,
        },
        handoffSnapshot: null,
      });
    },
    [activeSession, handleSend, streaming],
  );

  // ----- 多模型对比 -----
  // 对比流全程只活在浮层本地 state：不写会话消息、不占用会话级 streamingIds、
  // 不触发云同步；直到「采纳」才一次性落盘。浮层是 modal，天然阻止该会话在
  // 对比期间再发消息。
  const [compareTarget, setCompareTarget] = useState<CompareTarget | null>(null);

  const handleCompareMessage = useCallback(
    (message: AgentMessage) => {
      if (streaming || message.role !== 'assistant' || !activeSession) return;
      const idx = activeSession.messages.findIndex((m) => m.id === message.id);
      if (idx <= 0) return;
      const prior = activeSession.messages[idx - 1];
      if (prior.role !== 'user') return;
      const snapshotResult = readAetherHubRequestSnapshot(prior);
      if (snapshotResult.status === 'invalid') {
        toast.error(snapshotResult.message);
        return;
      }
      setCompareTarget({
        sessionId: activeSession.id,
        messageId: message.id,
        question: prior.content,
        baseMessages: activeSession.messages.slice(0, idx - 1),
        contextBreakId: activeSession.contextBreakId ?? null,
        // 快照缺失（旧消息）时退回 auto 契约 —— 对比与当前 picker 选择无关，
        // 不能把无关的实时选择混进历史问题的重放。
        requestSnapshot:
          snapshotResult.status === 'valid'
            ? snapshotResult.snapshot
            : {
                schemaVersion: 1,
                knowledgeContext: { mode: 'auto' },
                articleIds: null,
                tagSlugs: null,
              },
        sessionModelId: activeSession.modelId ?? null,
        sessionProviderCode: activeSession.providerCode ?? null,
        sessionModelParams: activeSession.modelParams,
        original: message,
      });
    },
    [activeSession, streaming],
  );

  // 采纳语义：用该列结果整体替换目标 assistant 消息（content / 模型戳记 /
  // usage / think / 计时戳全换，清错误与工具轨迹与译文），其余完成列 + 被
  // 替换的原回答存入 alternatives；bump updatedAt 让落盘与云同步随行。
  const handleAdoptCompare = useCallback(
    (adopted: CompareColumn, archivedColumns: CompareColumn[]) => {
      const target = compareTarget;
      if (!target) return;
      const session = sessionsRef.current.find((s) => s.id === target.sessionId);
      if (!session || !session.messages.some((m) => m.id === target.messageId)) {
        toast.error('原消息已不存在，无法采纳');
        setCompareTarget(null);
        return;
      }
      // 采纳同样 bump updatedAt → 同一道门禁。故意不关浮层：对比结果还在
      // liveRef / columns 里，等云端加载完再点一次「采纳」即可，不丢结果。
      if (!ensureSessionHydrated(target.sessionId)) return;
      const archived: AgentAlternative[] = archivedColumns.map((col) => ({
        modelId: col.model.modelId,
        providerCode: col.model.providerCode,
        content: col.content,
        ...(col.usage ? { usage: col.usage } : {}),
        ...(col.finishedAt !== undefined
          ? { elapsedMs: Math.max(0, col.finishedAt - col.startedAt) }
          : {}),
      }));
      const original = target.original;
      if (original.content.trim()) {
        archived.push({
          modelId: original.modelId ?? null,
          providerCode: original.providerCode ?? null,
          content: original.content,
          ...(original.usage ? { usage: original.usage } : {}),
          ...(original.finishedAt !== undefined && original.startedAt !== undefined
            ? { elapsedMs: Math.max(0, original.finishedAt - original.startedAt) }
            : {}),
        });
      }
      const now = Date.now();
      setSessions((prev) =>
        prev.map((s) =>
          s.id !== target.sessionId
            ? s
            : {
                ...s,
                updatedAt: now,
                messages: s.messages.map((m) =>
                  m.id !== target.messageId
                    ? m
                    : {
                        ...m,
                        content: adopted.content,
                        modelId: adopted.model.modelId,
                        providerCode: adopted.model.providerCode,
                        think: adopted.think || undefined,
                        usage: adopted.usage,
                        startedAt: adopted.startedAt,
                        firstTokenAt: adopted.firstTokenAt,
                        finishedAt: adopted.finishedAt ?? now,
                        pending: false,
                        error: undefined,
                        errorCode: undefined,
                        retryable: undefined,
                        toolEvents: undefined,
                        translation: undefined,
                        alternatives: archived.length > 0 ? archived : undefined,
                      },
                ),
              },
        ),
      );
      toast.success(`已采纳 ${modelLabel(adopted.model)} 的回答`);
      setCompareTarget(null);
    },
    [compareTarget, ensureSessionHydrated],
  );

  const handleDeleteMessage = useCallback(
    (message: AgentMessage) => {
      if (streaming || !activeSession) return;
      const idx = activeSession.messages.findIndex((m) => m.id === message.id);
      if (idx < 0) return;
      // 门禁前置到副作用之前（同 applyEditMessage）。
      if (!ensureSessionHydrated(activeSession.id)) return;
      // 被截断的消息（该条及之后）携带的附件：引用计数后 best-effort 回收。
      const remaining = activeSession.messages.slice(0, idx);
      reclaimAttachments(
        collectAttachmentIds(activeSession.messages.slice(idx)),
        sessionsRef.current.map((s) =>
          s.id === activeSession.id ? { ...s, messages: remaining } : s,
        ),
      );
      mutateSyncedSession(activeSession.id, (s) => {
        const nextMessages = s.messages.slice(0, idx);
        return {
          ...s,
          messages: nextMessages,
          contextBreakId: normalizeContextBreak(nextMessages, s.contextBreakId),
          updatedAt: Date.now(),
        };
      });
      toast.success('已删除此处及后续消息');
    },
    [
      activeSession,
      ensureSessionHydrated,
      mutateSyncedSession,
      reclaimAttachments,
      streaming,
    ],
  );

  // 清空当前对话（'/clear' 与移动端配置抽屉共用）—— 被清空消息携带的附件
  // 经引用计数后回收（历史版本这两处完全不回收，IndexedDB 里留孤儿原图）。
  const handleClearActiveMessages = useCallback(() => {
    if (!activeSession) return;
    if (streaming) {
      toast.info('请先停止当前回答');
      return;
    }
    // 门禁前置到副作用之前：清空是最危险的一条 —— 空壳会话被清空并 bump
    // updatedAt 后，刷新即以更晚时间戳覆盖服务端的全量历史。
    if (!ensureSessionHydrated(activeSession.id)) return;
    reclaimAttachments(
      collectAttachmentIds(activeSession.messages),
      sessionsRef.current.map((s) =>
        s.id === activeSession.id ? { ...s, messages: [] } : s,
      ),
    );
    mutateSyncedSession(activeSession.id, (s) => ({
      ...s,
      messages: [],
      title: '新对话',
      draft: '',
      updatedAt: Date.now(),
    }));
    setSelectedArticles([]);
    setSelectedTags([]);
    setSelectedKbs([]);
    setSelectedAtlasKps([]);
    clearActiveKnowledgeHandoff();
    toast.success('已清空当前对话');
  }, [
    activeSession,
    clearActiveKnowledgeHandoff,
    ensureSessionHydrated,
    mutateSyncedSession,
    reclaimAttachments,
    streaming,
  ]);

  // ----- 斜杠命令 -----
  const handleSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.kind === 'remote') {
        setComposer(cmd.template ?? cmd.command);
        return;
      }
      switch (cmd.command) {
        case '/clear':
          handleClearActiveMessages();
          return;
        case '/new':
          handleNewSession();
          return;
        case '/regen': {
          if (!activeSession || streaming) return;
          const msgs = activeSession.messages;
          const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
          if (!lastUser) {
            toast.info('当前对话没有可重发的用户消息');
            return;
          }
          const lastUserIndex = msgs.findIndex((message) => message.id === lastUser.id);
          retryUserTurn(lastUser, msgs.slice(0, lastUserIndex), activeSession);
          return;
        }
        default:
          toast.info(`命令 ${cmd.command} 暂未实现`);
      }
    },
    [
      activeSession,
      streaming,
      handleClearActiveMessages,
      handleNewSession,
      retryUserTurn,
      setComposer,
    ],
  );

  // ----- 附件大图预览（页面级单例）-----
  // 状态必须活在虚拟化列表之外：挂在消息行子树里时，行滚出缓冲区被卸载
  // 会让打开中的预览自己消失。见 AttachmentPreviewContext 的注释。
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewTarget | null>(null);

  // 离开路由时收掉所有页面级浮层。保活树只是 visibility:hidden，浮层的副作用**不**
  // 随之失效：
  //   - ConfirmModal 走 createPortal(document.body)，压根不在保活容器里，会继续
  //     浮在目标页面上且可点，确认后还去改那个已经看不见的会话；
  //   - CompareOverlay / AttachmentPreviewOverlay 走 useModalDialog，持有 body 滚动
  //     锁（position:fixed）与 capture 阶段的 window keydown —— 不关掉，目标页面会
  //     滚不动、键盘被拦，而移动端连按 Esc 自救的机会都没有；
  //   - 两个移动端抽屉留着也只是过期状态，回来时该重新按需打开。
  useEffect(() => {
    if (onRoute) return;
    setConfirmEditTarget(null);
    setCompareTarget(null);
    setAttachmentPreview(null);
    setMobileSessionOpen(false);
    setMobileConfigOpen(false);
    // 空间/参数侧栏是独立的 panelCollapsed，移动端展开时同样锁 body overflow
    // 并挂 document 级 Escape —— 不收起来，目标页面照样滚不动。
    setPanelCollapsed(true);
  }, [onRoute]);
  const closeAttachmentPreview = useCallback(() => setAttachmentPreview(null), []);

  if (!hydrated) {
    return <AetherHubSkeleton label="正在恢复灵境会话…" />;
  }

  const workspace = (
    <div className="aetherhub-workspace fixed inset-0 flex flex-col overflow-hidden bg-[var(--bg-void)] text-[var(--ink-primary)]">
      <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--bg-void)]">
        <div className="aurora-layer opacity-70" data-animated="true" aria-hidden="true" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'var(--hub-canvas-overlay)' }}
          aria-hidden="true"
        />

        <div
          className={cn(
            'relative z-10 grid h-full min-h-0 w-full grid-cols-1 overflow-hidden',
            sessionSidebarCollapsed
              ? 'lg:grid-cols-[0px_minmax(0,1fr)] xl:grid-cols-[0px_minmax(0,1fr)]'
              : 'lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]',
          )}
        >
          <WorkspaceSidebar
            collapsed={sessionSidebarCollapsed}
            currentUser={currentUser}
            sessions={sessions}
            activeId={activeId}
            streamingIds={streamingIds}
            onBack={() => navigate('/dashboard')}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onTogglePinSession={handleTogglePinSession}
            onRenameSession={handleRenameSession}
            onExportSession={handleExportSession}
            onOpenConfig={handleOpenCurrentConfig}
            onToggleCollapsed={() => setSessionSidebarCollapsed((v) => !v)}
          />

          <MobileSessionDrawer
            open={mobileSessionOpen}
            currentUser={currentUser}
            sessions={sessions}
            activeId={activeId}
            streamingIds={streamingIds}
            onClose={() => setMobileSessionOpen(false)}
            onBack={() => navigate('/dashboard')}
            onNewSession={handleNewSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onTogglePinSession={handleTogglePinSession}
            onRenameSession={handleRenameSession}
            onExportSession={handleExportSession}
            onOpenConfig={handleOpenCurrentConfig}
          />

          <section className="flex h-full min-h-0 min-w-0 flex-col border-x border-[var(--hub-border)]">
            <TopBar
              activeSession={activeSession}
              displayMode={displayMode}
              onSetDisplayMode={setDisplayMode}
              onNewSession={handleNewSession}
              onOpenSessions={() => setMobileSessionOpen(true)}
              sessionSidebarCollapsed={sessionSidebarCollapsed}
              onToggleSessionSidebar={() => setSessionSidebarCollapsed((v) => !v)}
              capabilityPanelOpen={!panelCollapsed}
              onToggleCapabilityPanel={() => setPanelCollapsed((v) => !v)}
            />

            {pendingKnowledgeHandoff && (
              <div className="relative z-20 flex min-h-10 items-center gap-2 border-b border-[var(--hub-border)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,var(--bg-substrate))] px-3 text-xs text-[var(--ink-secondary)] sm:px-4">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-1)]" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-[var(--ink-primary)]">已带入知识工作台任务</span>
                  {' · '}
                  {pendingKnowledgeHandoff.context.mode === 'selected'
                    ? `${pendingKnowledgeHandoff.context.refs.length} 个指定来源`
                    : pendingKnowledgeHandoff.context.mode === 'none'
                      ? '本次不使用来源'
                      : '自动检索有权限的知识库与知识点'}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/intelligence')}
                  className="hidden min-h-8 rounded-lg px-2.5 text-[11px] font-semibold text-[var(--aurora-1)] transition-colors hover:bg-[var(--hub-control-hover)] sm:inline-flex sm:items-center"
                >
                  返回调整
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearActiveKnowledgeHandoff();
                    // 按钮承诺的是「改用自动来源」。默认知识范围已经是 none，只
                    // 清交接会静默变成「本轮不检索」—— 与文案相反，所以这里必须
                    // 同时把自动检索打开。
                    setAutoKnowledge(true);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                  aria-label="改用自动来源"
                  title="改用自动来源"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <WorkspaceCanvas
              greeting={greeting}
              nickname={currentUser.nickname}
              currentUser={currentUser}
              activeSession={activeSession}
              modelsState={modelsState}
              streaming={streaming}
              composer={composer}
              displayMode={displayMode}
              streamAnimation={streamAnimation}
              fontSize={fontSize}
              sendShortcut={sendShortcut}
              onSetSendShortcut={setSendShortcut}
              enableTools={enableTools}
              onToggleEnableTools={() => setEnableTools((v) => !v)}
              onComposerChange={setComposer}
              onSend={handleSend}
              onAbort={handleAbort}
              onSetModel={handleSetModel}
              onPickPrompt={(text, options) => {
                setComposer(text);
                if (options?.needsKnowledge) setAutoKnowledge(true);
              }}
              selectedArticles={selectedArticles}
              selectedTags={selectedTags}
              selectedKbs={selectedKbs}
              selectedAtlasKps={selectedAtlasKps}
              onPickArticle={(article) =>
                setSelectedArticles((prev) =>
                  prev.find((a) => a.id === article.id) ? prev : [...prev, article],
                )
              }
              onPickTag={(tag) =>
                setSelectedTags((prev) =>
                  prev.find((t) => t.slug === tag.slug) ? prev : [...prev, tag],
                )
              }
              autoKnowledge={autoKnowledge}
              onToggleAutoKnowledge={() => {
                clearActiveKnowledgeHandoff();
                setAutoKnowledge((v) => !v);
              }}
              onPickKb={(kb) => {
                clearActiveKnowledgeHandoff();
                setSelectedKbs((prev) =>
                  prev.find((k) => k.id === kb.id) ? prev : [...prev, kb],
                );
              }}
              onPickAtlasKp={(kp) => {
                clearActiveKnowledgeHandoff();
                setSelectedAtlasKps((prev) =>
                  prev.find((item) => item.id === kp.id) ? prev : [...prev, kp],
                );
              }}
              onRemoveArticle={(id) =>
                setSelectedArticles((prev) => prev.filter((a) => a.id !== id))
              }
              onRemoveTag={(slug) =>
                setSelectedTags((prev) => prev.filter((t) => t.slug !== slug))
              }
              onRemoveKb={(id) => setSelectedKbs((prev) => prev.filter((k) => k.id !== id))}
              onRemoveAtlasKp={(id) => setSelectedAtlasKps((prev) => prev.filter((kp) => kp.id !== id))}
              onSlashCommand={handleSlashCommand}
              onEditMessage={handleEditMessage}
              onRetryMessage={handleRetryMessage}
              onRetryAutoMessage={handleRetryMessageAuto}
              onCompareMessage={handleCompareMessage}
              onDeleteMessage={handleDeleteMessage}
              onTranslateMessage={handleTranslateMessage}
              onQuoteMessage={handleQuoteMessage}
              onForkMessage={handleForkMessage}
              onToggleContextBreak={handleToggleContextBreak}
              onClearContextBreak={handleClearContextBreak}
              attachments={composerAttachments}
              onAddAttachments={handleAddAttachments}
              onRemoveAttachment={handleRemoveAttachment}
            />
          </section>

          <ContextPanel
            session={activeSession}
            modelsState={modelsState}
            collapsed={panelCollapsed}
            selectedArticles={selectedArticles}
            selectedTags={selectedTags}
            selectedKbs={selectedKbs}
            selectedAtlasKps={selectedAtlasKps}
            displayMode={displayMode}
            onSetDisplayMode={setDisplayMode}
            streamAnimation={streamAnimation}
            onSetStreamAnimation={setStreamAnimation}
            fontSize={fontSize}
            onSetFontSize={setFontSize}
            onSetModelParam={handleSetModelParam}
            onResetModelParams={handleResetModelParams}
            onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
            onRemoveArticle={(id) =>
              setSelectedArticles((prev) => prev.filter((a) => a.id !== id))
            }
            onRemoveTag={(slug) =>
              setSelectedTags((prev) => prev.filter((t) => t.slug !== slug))
            }
            onRemoveKb={(id) => setSelectedKbs((prev) => prev.filter((k) => k.id !== id))}
            onRemoveAtlasKp={(id) => setSelectedAtlasKps((prev) => prev.filter((kp) => kp.id !== id))}
          />

          <MobileContextSheet
            open={mobileConfigOpen}
            session={activeSession}
            modelsState={modelsState}
            displayMode={displayMode}
            onSetDisplayMode={setDisplayMode}
            streamAnimation={streamAnimation}
            onSetStreamAnimation={setStreamAnimation}
            fontSize={fontSize}
            onSetFontSize={setFontSize}
            onClose={() => setMobileConfigOpen(false)}
            onDeleteSession={() => activeSession && handleDeleteSession(activeSession.id)}
            onClearMessages={handleClearActiveMessages}
          />

          <ConfirmModal
            isOpen={!!confirmEditTarget}
            title="编辑这条消息？"
            message="编辑会把这条消息填回输入框，并删除它之后的所有回复。此操作无法撤销。"
            confirmText="编辑并截断"
            cancelText="取消"
            variant="warning"
            onConfirm={() => {
              if (confirmEditTarget) applyEditMessage(confirmEditTarget);
              setConfirmEditTarget(null);
            }}
            onCancel={() => setConfirmEditTarget(null)}
          />

          {/* 多模型对比浮层 —— key 绑定目标消息：换目标即整体重置浮层状态。 */}
          <AnimatePresence>
            {compareTarget && (
              <CompareOverlay
                key={`${compareTarget.sessionId}:${compareTarget.messageId}`}
                target={compareTarget}
                modelsState={modelsState}
                onClose={() => setCompareTarget(null)}
                onAdopt={handleAdoptCompare}
              />
            )}
          </AnimatePresence>

          {/* 附件大图预览 —— 渲染在虚拟化列表之外，滚动不再把它连根卸载。 */}
          <AnimatePresence>
            {attachmentPreview && (
              <AttachmentPreviewOverlay
                target={attachmentPreview}
                onClose={closeAttachmentPreview}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );

  return (
    <AttachmentPreviewContext.Provider value={setAttachmentPreview}>
      {workspace}
    </AttachmentPreviewContext.Provider>
  );
}

// =============================================================================
// 侧栏 —— 会话列表 + 新建按钮 + 用户信息
// =============================================================================

function SidebarTopControls({
  sidebarLabel,
  onSidebarAction,
  onNewSession,
}: {
  sidebarLabel: string;
  onSidebarAction: () => void;
  onNewSession: () => void;
}) {
  return (
    <div className="inline-flex h-12 items-center gap-1.5 rounded-[26px] border border-[var(--hub-border)] bg-[color-mix(in_oklch,var(--hub-control)_78%,var(--ink-primary)_8%)] p-1 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_8%,transparent),0_14px_34px_-28px_rgba(0,0,0,0.42)]">
      <button
        type="button"
        onClick={onSidebarAction}
        aria-label={sidebarLabel}
        title={sidebarLabel}
        className="grid h-10 w-10 place-items-center rounded-[22px] bg-[color-mix(in_oklch,var(--hub-control-hover)_78%,var(--ink-primary)_12%)] text-[var(--ink-primary)] shadow-[0_8px_18px_-14px_rgba(0,0,0,0.45),inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_12%,transparent)] transition-[background-color,color,transform] hover:text-[var(--ink-primary)] active:scale-[0.97]"
      >
        <SidebarIcon className="h-5 w-5" strokeWidth={2.15} />
      </button>
      <button
        type="button"
        onClick={onNewSession}
        aria-label="新建对话"
        title="新建对话"
        className="grid h-10 w-10 place-items-center rounded-[22px] text-[var(--ink-secondary)] transition-[background-color,color,transform] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] active:scale-[0.97]"
      >
        <SquarePen className="h-5 w-5" strokeWidth={2.15} />
      </button>
    </div>
  );
}

function WorkspaceSidebar({
  collapsed,
  currentUser,
  sessions,
  activeId,
  streamingIds,
  onBack,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onTogglePinSession,
  onRenameSession,
  onExportSession,
  onOpenConfig,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  currentUser: CurrentUser;
  sessions: AgentSession[];
  activeId: string | null;
  streamingIds: ReadonlySet<string>;
  onBack: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onTogglePinSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onExportSession: (id: string) => void;
  onOpenConfig: () => void;
  onToggleCollapsed: () => void;
}) {
  const [query, setQuery] = useState('');
  const filteredSessions = useMemo(() => filterSessions(sessions, query), [sessions, query]);
  const groups = useMemo(() => groupSessionsByRecency(filteredSessions), [filteredSessions]);

  if (collapsed) {
    return <aside className="hidden h-full min-w-0 overflow-hidden lg:block" aria-hidden="true" />;
  }

  return (
    <aside className="hidden h-full min-h-0 flex-col border-r border-[var(--hub-border)] bg-[var(--hub-panel)] px-3 py-3 backdrop-blur-2xl lg:flex">
      <div className="mb-3 flex h-12 items-center px-1">
        <SidebarTopControls
          sidebarLabel="收起侧边栏"
          onSidebarAction={onToggleCollapsed}
          onNewSession={onNewSession}
        />
      </div>

      <nav className="mb-3 space-y-1 px-1" aria-label="灵境导航">
        <button
          type="button"
          aria-current="page"
          className="flex h-10 w-full items-center gap-3 rounded-xl bg-[var(--hub-active)] px-3 text-left text-sm font-medium text-[var(--hub-accent-text)]"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center">
            <AetherMark className="h-5 w-5" />
          </span>
          灵境
        </button>
      </nav>

      <div className="relative mb-3 px-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="搜索对话..."
          className="h-10 w-full rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] pl-9 pr-3 text-sm text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] focus:outline-none focus:ring-1 focus:ring-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]"
        />
      </div>

      <div className="agent-thumb-scroll min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {filteredSessions.length === 0 && (
          <div className="px-2 py-6 text-center text-[var(--fs-caption)] text-[var(--ink-muted)]">
            {query.trim() ? '没有匹配的对话' : '暂无会话，从上方「新建对话」开始'}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1 px-2 text-[var(--fs-caption)] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  streaming={streamingIds.has(session.id)}
                  onSelect={() => onSelectSession(session.id)}
                  onDelete={() => onDeleteSession(session.id)}
                  onTogglePin={() => onTogglePinSession(session.id)}
                  onRename={(title) => onRenameSession(session.id, title)}
                  onExport={() => onExportSession(session.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--hub-border)] px-1 pt-3">
        <div className="flex h-12 items-center gap-3 rounded-xl px-2 text-[var(--ink-primary)]">
          <UserAvatar currentUser={currentUser} className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--ink-primary)]">
              {currentUser.nickname}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onBack}
              aria-label="返回管理后台"
              title="返回管理后台"
              className="grid h-10 w-10 place-items-center rounded-xl text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            >
              <LayoutDashboard className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onOpenConfig}
              aria-label="打开当前对话配置"
              title="当前对话配置"
              className="grid h-10 w-10 place-items-center rounded-xl text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileSessionDrawer({
  open,
  currentUser,
  sessions,
  activeId,
  streamingIds,
  onClose,
  onBack,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onTogglePinSession,
  onRenameSession,
  onExportSession,
  onOpenConfig,
}: {
  open: boolean;
  currentUser: CurrentUser;
  sessions: AgentSession[];
  activeId: string | null;
  streamingIds: ReadonlySet<string>;
  onClose: () => void;
  onBack: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onTogglePinSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onExportSession: (id: string) => void;
  onOpenConfig: () => void;
}) {
  const [query, setQuery] = useState('');
  const filteredSessions = useMemo(() => filterSessions(sessions, query), [sessions, query]);
  const groups = useMemo(() => groupSessionsByRecency(filteredSessions), [filteredSessions]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="对话记录"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34, mass: 0.9 }}
            className="relative flex h-full w-[min(88vw,360px)] flex-col border-r border-[var(--hub-border)] bg-[var(--hub-panel)] p-4 shadow-[24px_0_54px_-30px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
          >
            <div className="mb-3 flex h-12 items-center">
              <SidebarTopControls
                sidebarLabel="收起侧边栏"
                onSidebarAction={onClose}
                onNewSession={() => {
                  onNewSession();
                  onClose();
                }}
              />
            </div>

            <nav className="mb-3 space-y-1" aria-label="灵境导航">
              <button
                type="button"
                aria-current="page"
                className="flex h-11 w-full items-center gap-3 rounded-2xl bg-[var(--hub-active)] px-3 text-left text-sm font-medium text-[var(--hub-accent-text)]"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center">
                  <AetherMark className="h-5 w-5" />
                </span>
                灵境
              </button>
            </nav>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
                placeholder="搜索对话..."
                className="h-11 w-full rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] pl-9 pr-3 text-sm text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] focus:outline-none focus:ring-1 focus:ring-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)]"
              />
            </div>

            <div className="agent-thumb-scroll min-h-0 flex-1 overflow-y-auto pr-1">
              {filteredSessions.length === 0 && (
                <div className="px-2 py-8 text-center text-[12px] text-[var(--ink-muted)]">
                  {query.trim() ? '没有匹配的对话' : '暂无会话，从上方新建对话开始'}
                </div>
              )}
              {groups.map((group) => (
                <div key={group.label} className="mb-4">
                  <div className="mb-1 px-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        active={session.id === activeId}
                        streaming={streamingIds.has(session.id)}
                        showActions
                        onSelect={() => {
                          onSelectSession(session.id);
                          onClose();
                        }}
                        onDelete={() => onDeleteSession(session.id)}
                        onTogglePin={() => onTogglePinSession(session.id)}
                        onRename={(title) => onRenameSession(session.id, title)}
                        onExport={() => onExportSession(session.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-[var(--hub-border)] pt-3">
              <div className="flex h-12 items-center gap-3 rounded-2xl px-2 text-[var(--ink-primary)]">
                <UserAvatar currentUser={currentUser} className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--ink-primary)]">
                    {currentUser.nickname}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onBack();
                      onClose();
                    }}
                    aria-label="返回管理后台"
                    title="返回管理后台"
                    className="grid h-10 w-10 place-items-center rounded-xl text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                  >
                    <LayoutDashboard className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenConfig();
                      onClose();
                    }}
                    aria-label="打开当前对话配置"
                    title="当前对话配置"
                    className="grid h-10 w-10 place-items-center rounded-xl text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                  >
                    <Settings className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

function SessionRow({
  session,
  active,
  streaming = false,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
  onExport,
  showActions = false,
}: {
  session: AgentSession;
  active: boolean;
  /** 该会话正在流式生成 —— 行尾显示呼吸点。 */
  streaming?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRename: (title: string) => void;
  onExport: () => void;
  /** 触屏（无 hover）场景下常显操作入口。 */
  showActions?: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  // 尊重系统「减少动态效果」：操作条展开改为瞬时。
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!renaming) return;
    setDraftTitle(session.title);
    const raf = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
    // 依赖刻意只挂 renaming：进入重命名态时取一次快照，编辑期间外部改名不打断输入。
  }, [renaming]);

  useEffect(() => {
    if (!confirmDelete) return;
    const id = window.setTimeout(() => setConfirmDelete(false), 1800);
    return () => window.clearTimeout(id);
  }, [confirmDelete]);

  const commitRename = () => {
    setRenaming(false);
    const next = draftTitle.trim();
    if (next && next !== session.title) onRename(next);
  };

  if (renaming) {
    return (
      <div className="flex h-10 w-full items-center rounded-xl bg-[var(--hub-control-hover)] px-2">
        <input
          ref={renameInputRef}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          maxLength={60}
          aria-label="重命名对话"
          className="h-8 w-full rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)] bg-transparent px-2 text-sm text-[var(--ink-primary)] outline-none"
        />
      </div>
    );
  }

  return (
    <div className="group">
      <div
        className={cn(
          'relative flex h-10 w-full items-center gap-1.5 rounded-xl px-3 text-sm transition-colors',
          active
            ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
            : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
        )}
      >
        {session.pinned && (
          <Pin className="h-3 w-3 shrink-0 text-[var(--aurora-1)]" aria-label="已置顶" />
        )}
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center text-left"
        >
          <span className="min-w-0 truncate pr-6">{session.title || '新对话'}</span>
          <span className="sr-only">
            最近更新：{formatRelativeShort(session.updatedAt)}
          </span>
        </button>
        {streaming && (
          <span
            className="hub-think-live-dot shrink-0"
            aria-label="正在生成回答"
            title="正在生成回答"
          />
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="对话操作"
          title="对话操作"
          className={cn(
            'absolute right-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--ink-muted)] transition-all hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
            menuOpen || showActions ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 行内展开操作条 —— 不用浮层，避免在滚动容器里被裁剪 */}
      <AnimatePresence initial={false}>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mx-1 mt-0.5 flex items-center gap-0.5 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-1">
              <button
                type="button"
                onClick={() => {
                  onTogglePin();
                  setMenuOpen(false);
                }}
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg text-[11px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              >
                {session.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                {session.pinned ? '取消置顶' : '置顶'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(true);
                }}
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg text-[11px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              >
                <Pencil className="h-3 w-3" />
                重命名
              </button>
              <button
                type="button"
                onClick={() => {
                  onExport();
                  setMenuOpen(false);
                }}
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg text-[11px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              >
                <Download className="h-3 w-3" />
                导出
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmDelete) {
                    setConfirmDelete(false);
                    setMenuOpen(false);
                    onDelete();
                  } else {
                    setConfirmDelete(true);
                  }
                }}
                className={cn(
                  'flex h-8 flex-1 items-center justify-center gap-1 rounded-lg text-[11px] transition-colors',
                  confirmDelete
                    ? 'bg-[color-mix(in_oklch,var(--signal-danger)_14%,transparent)] text-[var(--signal-danger)]'
                    : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--signal-danger)]',
                )}
              >
                <Trash2 className="h-3 w-3" />
                {confirmDelete ? '确认？' : '删除'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// 顶栏 —— 会话标题 + 移动端快捷入口
// =============================================================================

function TopBar({
  activeSession,
  displayMode,
  onSetDisplayMode,
  onNewSession,
  onOpenSessions,
  sessionSidebarCollapsed,
  onToggleSessionSidebar,
  capabilityPanelOpen,
  onToggleCapabilityPanel,
}: {
  activeSession: AgentSession | null;
  displayMode: DisplayMode;
  onSetDisplayMode: (mode: DisplayMode) => void;
  onNewSession: () => void;
  onOpenSessions: () => void;
  sessionSidebarCollapsed: boolean;
  onToggleSessionSidebar: () => void;
  capabilityPanelOpen: boolean;
  onToggleCapabilityPanel: () => void;
}) {
  const { isDark, toggleThemeWithAnimation } = useTheme();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--hub-border)] bg-[var(--hub-panel)] px-3 backdrop-blur-2xl md:h-[60px] md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={sessionSidebarCollapsed ? onToggleSessionSidebar : onOpenSessions}
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
            sessionSidebarCollapsed ? 'lg:grid' : 'lg:hidden',
          )}
          aria-label={sessionSidebarCollapsed ? '展开侧边栏' : '打开对话记录'}
          title={sessionSidebarCollapsed ? '展开侧边栏' : '打开对话记录'}
        >
          <SidebarIcon className="h-[18px] w-[18px]" strokeWidth={2.15} />
        </button>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--hub-control)] ring-1 ring-[var(--hub-border)] md:bg-transparent md:ring-0">
          <AetherMark size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-[var(--ink-primary)] md:text-sm">
            {activeSession?.title || 'AetherHub'}
          </div>
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-full bg-[var(--hub-control)] p-1 md:h-auto md:gap-2 md:bg-transparent md:p-0">
        <button
          type="button"
          onClick={() => onSetDisplayMode(displayMode === 'bubble' ? 'engraved' : 'bubble')}
          aria-label={displayMode === 'bubble' ? '切换到版书模式' : '切换到气泡模式'}
          title={displayMode === 'bubble' ? '切换到版书模式' : '切换到气泡模式'}
          className="grid h-8 w-8 place-items-center rounded-full text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] md:h-9 md:w-9 md:rounded-lg"
        >
          {displayMode === 'bubble' ? <BookOpen className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
        </button>
        <button
          type="button"
          data-theme-toggle
          onClick={(e) => toggleThemeWithAnimation(e.clientX, e.clientY)}
          aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          className="grid h-8 w-8 place-items-center rounded-full text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] md:h-9 md:w-9 md:rounded-lg"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onToggleCapabilityPanel}
          aria-pressed={capabilityPanelOpen}
          aria-label={capabilityPanelOpen ? '关闭空间与参数侧栏' : '打开空间与参数侧栏'}
          title={capabilityPanelOpen ? '关闭空间与参数侧栏' : '空间与参数'}
          className={cn(
            'grid h-8 w-8 place-items-center rounded-full transition-colors md:h-9 md:w-9 md:rounded-lg',
            capabilityPanelOpen
              ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
              : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
          )}
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNewSession}
          aria-label="新建对话"
          title="新建对话"
          className="grid h-8 w-8 place-items-center rounded-full text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] md:hidden"
        >
          <SquarePen className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function UserAvatar({
  currentUser,
  className,
}: {
  currentUser: CurrentUser;
  className?: string;
}) {
  const fallback = (
    <div
      className={cn(
        'grid shrink-0 place-items-center rounded-full text-sm font-semibold text-[var(--hub-on-accent)] ring-1 ring-[color-mix(in_oklch,var(--aurora-1)_34%,transparent)] [background:var(--hub-gradient)]',
        className,
      )}
      aria-label={currentUser.nickname}
      title={currentUser.nickname}
    >
      {currentUser.initial}
    </div>
  );

  if (!currentUser.avatarUrl) return fallback;

  return (
    <CachedAvatar
      src={currentUser.avatarUrl}
      alt={currentUser.nickname}
      className={cn('shrink-0 rounded-full object-cover ring-1 ring-[var(--hub-border)]', className)}
      fallback={fallback}
    />
  );
}

// =============================================================================
// 模型选择
// =============================================================================

function ModelPickerButton({
  activeSession,
  modelsState,
  disabled,
  onSetModel,
  placement = 'bottom',
  align = 'end',
}: {
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  disabled: boolean;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  placement?: 'top' | 'bottom';
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const { mobileHeight, handleResizeStart } = useMobilePickerResize(open);
  const navigate = useNavigate();

  // 供应商配置深链 —— AiConfigPage 已支持 ?provider=&model=（见该页 useEffect
  // 里的一次性深链应用），所以这里只负责拼参数，不需要另建跳转协议。
  const openProviderConfig = useCallback(
    (providerCode: string, modelId?: string) => {
      setOpen(false);
      const params = new URLSearchParams({ provider: providerCode });
      if (modelId) params.set('model', modelId);
      navigate(`/ai-config?${params.toString()}`);
    },
    [navigate],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ESC 关闭 —— 跳过 IME 组合态：面板内有模型搜索框，中文输入法按 Esc 取消
  // 候选词时浏览器同样派发 key='Escape'，不放行会把面板连同已输入的筛选一起关掉。
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const items = modelsState.status === 'ready' ? modelsState.items : [];
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [
        item.providerCode,
        item.providerName,
        item.modelId,
        item.displayName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filteredItems>();
    for (const item of filteredItems) {
      const key = item.providerCode;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  const currentLabel = useMemo(() => {
    if (!activeSession?.modelId) return '自动路由';
    const found = items.find(
      (m) => m.modelId === activeSession.modelId && m.providerCode === activeSession.providerCode,
    );
    return found ? modelLabel(found) : activeSession.modelId;
  }, [activeSession?.modelId, activeSession?.providerCode, items]);

  const currentModel = useMemo(() => {
    if (!activeSession?.modelId) return null;
    return (
      items.find(
        (m) =>
          m.modelId === activeSession.modelId && m.providerCode === activeSession.providerCode,
      ) ?? null
    );
  }, [activeSession?.modelId, activeSession?.providerCode, items]);
  const currentContext = formatContextWindow(currentModel?.contextWindow);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'inline-flex h-10 max-w-[40vw] items-center gap-2 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] py-1 pl-2 pr-2.5 text-[13px] text-[var(--ink-primary)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_8%,transparent)] transition-colors hover:bg-[var(--hub-control-hover)] sm:max-w-[238px] md:h-9 md:text-sm',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]">
          {activeSession?.modelId ? <AetherMark className="h-4 w-4" /> : <Bot className="h-3.5 w-3.5" />}
        </span>
        <span className="truncate">{currentLabel}</span>
        {currentContext && (
          <span className="hidden shrink-0 rounded-md bg-[var(--hub-control-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)] sm:inline">
            {currentContext}
          </span>
        )}
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="选择模型"
          style={
            {
              '--hub-picker-height': `${mobileHeight}px`,
            } as React.CSSProperties
          }
          className={cn(
            'fixed inset-x-4 bottom-[calc(max(0.85rem,env(safe-area-inset-bottom))+8rem)] z-50 flex h-[min(var(--hub-picker-height),calc(100vh-10.5rem))] flex-col overflow-hidden rounded-[1.6rem] border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)] backdrop-blur-2xl',
            'sm:absolute sm:inset-x-auto sm:h-auto sm:w-[min(460px,calc(100vw-2rem))] sm:max-h-none sm:rounded-2xl sm:shadow-[0_24px_64px_-20px_rgba(0,0,0,0.42)]',
            placement === 'top' ? 'sm:bottom-full sm:mb-3' : 'sm:top-full sm:mt-2',
            align === 'end' ? 'sm:right-0' : 'sm:left-0',
          )}
        >
          <PickerResizeHandle onPointerDown={handleResizeStart} />
          <PickerPanelHeader
            title="模型路由"
            description={`当前：${currentLabel}`}
            query={query}
            onQueryChange={setQuery}
            placeholder="搜索模型、厂商或上下文..."
            inputRef={modelSearchRef}
          />

          <div className="agent-thumb-scroll min-h-0 flex-1 overflow-y-auto p-2 sm:max-h-[min(480px,60vh)] sm:flex-none">
            <button
              type="button"
              onClick={() => {
                onSetModel(null, null);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors',
                !activeSession?.modelId
                  ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                  : 'text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)]',
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">自动路由</div>
                <div className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">
                  按任务路由策略自动选模型
                </div>
              </div>
              {!activeSession?.modelId && <Check className="h-4 w-4 shrink-0" />}
            </button>

          {modelsState.status === 'loading' && (
            <div className="space-y-2 px-3 py-4" aria-label="加载模型清单">
              <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--hub-control-hover)]" />
              <div className="h-9 animate-pulse rounded-xl bg-[var(--hub-control)]" />
              <div className="h-9 animate-pulse rounded-xl bg-[var(--hub-control)]" />
            </div>
          )}

          {modelsState.status === 'error' && (
            <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
              加载失败：{modelsState.message}
            </div>
          )}

          {modelsState.status === 'ready' && grouped.length === 0 && (
            <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--ink-muted)]">
              {query.trim() ? (
                '没有匹配的模型'
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('/ai-config');
                  }}
                  className="text-left text-[var(--aurora-1)] underline-offset-2 hover:underline"
                >
                  没有已启用的模型，去 AI 配置页添加 →
                </button>
              )}
            </div>
          )}

          {grouped.map(([providerCode, list]) => (
            <div key={providerCode} className="mt-2">
              <div className="flex items-center gap-2 px-3 pb-1.5 text-[11px] font-medium text-[var(--ink-muted)]">
                <span className="min-w-0 flex-1 truncate">
                  {list[0]?.providerName || providerCode}
                </span>
                <button
                  type="button"
                  onClick={() => openProviderConfig(providerCode)}
                  title={`配置 ${list[0]?.providerName || providerCode}`}
                  aria-label={`配置 ${list[0]?.providerName || providerCode}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10.5px] text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--aurora-1)]"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  配置
                </button>
              </div>
              {list.map((m) => {
                const selected =
                  activeSession?.modelId === m.modelId &&
                  activeSession?.providerCode === m.providerCode;
                return (
                  <button
                    key={`${m.providerCode}:${m.modelId}`}
                    type="button"
                    onClick={() => {
                      onSetModel(m.modelId, m.providerCode);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors',
                      selected
                        ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                        : 'text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)]',
                    )}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--hub-control)] text-[var(--ink-muted)]">
                      <Brain className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{modelLabel(m)}</span>
                        {m.isDefault && (
                          <span className="shrink-0 rounded-md bg-[var(--hub-control)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                            默认
                          </span>
                        )}
                      </div>
                      {m.contextWindow && (
                        <div className="mt-0.5 text-[11.5px] tnum text-[var(--ink-muted)]">
                          上下文 {Math.round(m.contextWindow / 1000)}K
                        </div>
                      )}
                    </div>
                    {selected ? (
                      <Check className="h-4 w-4 shrink-0" />
                    ) : m.contextWindow ? (
                      <span className="hidden shrink-0 rounded-full bg-[var(--hub-control)] px-2 py-1 font-mono text-[10px] tnum text-[var(--ink-muted)] sm:inline">
                        {formatContextWindow(m.contextWindow)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
          </div>

          {/* 直达当前模型的服务商配置 —— 灵境里换模型和调服务商参数是同一件事的
              两半，没有这条就得手动翻侧栏找 AI 配置再自己认出是哪家。 */}
          <div className="border-t border-[var(--hub-border)] p-2">
            <button
              type="button"
              onClick={() =>
                currentModel
                  ? openProviderConfig(currentModel.providerCode, currentModel.modelId)
                  : (setOpen(false), navigate('/ai-config'))
              }
              className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-[12.5px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--hub-control)] text-[var(--ink-muted)]">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {currentModel ? `配置 ${currentModel.providerName || currentModel.providerCode}` : '管理模型与服务商'}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 主区 —— 空态欢迎 / 消息流 + 输入框
// =============================================================================

/**
 * 超过 ENTER 条才启用 virtua 虚拟化；低于 EXIT 条才退出。短会话保留原始
 * flex+gap 渲染路径：全量挂载对短列表毫无压力，且能原样保留 framer-motion
 * 的 layout 动画与逐条入场动画，把虚拟化的行为差异（绝对定位、行卸载）
 * 限制在真正需要它的长会话里，降低回归面。
 *
 * 两个阈值之间留迟滞带：在 30 附近增删一条消息（31→30→31）不会让渲染
 * 分支来回切换 —— 分支切换 = 全部行卸载重挂载，无迟滞会伴随整屏动画重放
 * 与滚动位置抖动。
 */
const VIRTUALIZE_ENTER_MESSAGES = 30;
const VIRTUALIZE_EXIT_MESSAGES = 24;

function WorkspaceCanvas({
  greeting,
  nickname,
  currentUser,
  activeSession,
  modelsState,
  streaming,
  composer,
  displayMode,
  streamAnimation,
  fontSize,
  sendShortcut,
  onSetSendShortcut,
  enableTools,
  onToggleEnableTools,
  onComposerChange,
  onSend,
  onAbort,
  onSetModel,
  onPickPrompt,
  selectedArticles,
  selectedTags,
  selectedKbs,
  selectedAtlasKps,
  autoKnowledge,
  onToggleAutoKnowledge,
  onPickArticle,
  onPickTag,
  onPickKb,
  onPickAtlasKp,
  onRemoveArticle,
  onRemoveTag,
  onRemoveKb,
  onRemoveAtlasKp,
  onSlashCommand,
  onEditMessage,
  onRetryMessage,
  onRetryAutoMessage,
  onCompareMessage,
  onDeleteMessage,
  onTranslateMessage,
  onQuoteMessage,
  onForkMessage,
  onToggleContextBreak,
  onClearContextBreak,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
}: {
  greeting: string;
  nickname: string;
  currentUser: CurrentUser;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  streaming: boolean;
  composer: string;
  displayMode: DisplayMode;
  streamAnimation: StreamAnimationMode;
  fontSize: number;
  sendShortcut: SendShortcut;
  onSetSendShortcut: (shortcut: SendShortcut) => void;
  enableTools: boolean;
  onToggleEnableTools: () => void;
  onComposerChange: (value: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  onPickPrompt: (text: string, options?: { needsKnowledge?: boolean }) => void;
  selectedArticles: AgentArticle[];
  selectedTags: AgentTag[];
  selectedKbs: AgentKnowledgeBase[];
  selectedAtlasKps: AtlasKnowledgePoint[];
  autoKnowledge: boolean;
  onToggleAutoKnowledge: () => void;
  onPickArticle: (article: AgentArticle) => void;
  onPickTag: (tag: AgentTag) => void;
  onPickKb: (kb: AgentKnowledgeBase) => void;
  onPickAtlasKp: (kp: AtlasKnowledgePoint) => void;
  onRemoveArticle: (id: number) => void;
  onRemoveTag: (slug: string) => void;
  onRemoveKb: (id: number) => void;
  onRemoveAtlasKp: (id: number) => void;
  onSlashCommand: (cmd: SlashCommand) => void;
  onEditMessage: (message: AgentMessage) => void;
  onRetryMessage: (message: AgentMessage) => void;
  onRetryAutoMessage: (message: AgentMessage) => void;
  onCompareMessage: (message: AgentMessage) => void;
  onDeleteMessage: (message: AgentMessage) => void;
  onTranslateMessage: (message: AgentMessage) => void;
  onQuoteMessage: (message: AgentMessage) => void;
  onForkMessage: (message: AgentMessage) => void;
  onToggleContextBreak: () => void;
  onClearContextBreak: () => void;
  attachments: AgentAttachment[];
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const isEmpty = !activeSession || activeSession.messages.length === 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 虚拟化路径的命令句柄；非虚拟化路径下保持 null，effect 里以此区分分支
  const virtualizerRef = useRef<VirtualizerHandle | null>(null);
  // 用户主动滚动到非底部 → 暂停自动跟随；滚回底部 80px 内 → 恢复跟随
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastSessionIdRef = useRef<string | null | undefined>(undefined);

  const messages = activeSession?.messages ?? [];

  // 虚拟化开关带迟滞（ref 记当前模式）：>ENTER 进入、<EXIT 退出。
  const virtualizedRef = useRef(false);

  // 入场动画只授予「本次挂载期间新追加」的消息。虚拟化行滚出视口即卸载，
  // 滚回来会重挂载 —— 若不做标记，回滚历史时旧消息会重复播放入场动画。
  // 非虚拟化分支同样按此标记：跨过阈值退出虚拟化时整列表重挂载，无标记
  // 会把已见历史的入场动画整屏重放。切会话时把该会话现有消息全部视为已见
  // （历史直接静态呈现）。
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const seenSessionIdRef = useRef<string | null | undefined>(undefined);
  if (seenSessionIdRef.current !== (activeSession?.id ?? null)) {
    seenSessionIdRef.current = activeSession?.id ?? null;
    seenMessageIdsRef.current = new Set(messages.map((m) => m.id));
    // 切会话按新会话自身规模定档，不携带上一个会话的迟滞状态。
    virtualizedRef.current = messages.length > VIRTUALIZE_ENTER_MESSAGES;
  }
  if (messages.length > VIRTUALIZE_ENTER_MESSAGES) virtualizedRef.current = true;
  else if (messages.length < VIRTUALIZE_EXIT_MESSAGES) virtualizedRef.current = false;
  const virtualized = virtualizedRef.current;
  useEffect(() => {
    const seen = seenMessageIdsRef.current;
    for (const m of messages) seen.add(m.id);
  }, [messages]);

  // 切换会话时重置为"贴底"，并立即跳到底部
  useEffect(() => {
    if (lastSessionIdRef.current !== activeSession?.id) {
      lastSessionIdRef.current = activeSession?.id;
      setStickToBottom(true);
    }
  }, [activeSession?.id]);

  // 监听用户滚动 —— 距底部 < 80px 视为"想跟随"，> 80px 视为"主动往上看"
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    let raf = 0;
    const onScroll = () => {
      // 节流：合并同帧多次 scroll 事件
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!node.isConnected) return;
        const distFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
        setStickToBottom((prev) => {
          const next = distFromBottom < 80;
          return prev === next ? prev : next;
        });
      });
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // 仅当 stickToBottom=true 才 auto-scroll，且走 rAF 等布局稳定后再设
  // scrollTop —— 之前 useLayoutEffect 同步设置 scrollHeight 在 streaming
  // 高频 reflow 下会读到陈旧值（content 已增但 layout 未完），导致内容被
  // 顶到视口外。
  useEffect(() => {
    if (!stickToBottom) return;
    const node = scrollRef.current;
    if (!node) return;
    const count = messages.length;
    const id = requestAnimationFrame(() => {
      // 虚拟化下 scrollHeight 含未测量项的估算值，直接赋 scrollTop 可能落
      // 不到真实底部；scrollToIndex(end) 由 virtua 在测量修正后收敛贴底。
      const handle = virtualizerRef.current;
      if (handle && count > 0) {
        handle.scrollToIndex(count - 1, { align: 'end' });
      } else {
        node.scrollTop = node.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [messages, streaming, stickToBottom]);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setStickToBottom(true);
    const handle = virtualizerRef.current;
    if (handle && messages.length > 0) {
      handle.scrollToIndex(messages.length - 1, { align: 'end', smooth: true });
    } else {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length]);

  const renderMessageRow = (m: AgentMessage, rowAnimation: { entrance: boolean; animateLayout: boolean }) => (
    <MessageRow
      message={m}
      displayMode={displayMode}
      streamAnimation={streamAnimation}
      fontSize={fontSize}
      currentUser={currentUser}
      modelsState={modelsState}
      busy={streaming}
      entrance={rowAnimation.entrance}
      animateLayout={rowAnimation.animateLayout}
      onEdit={onEditMessage}
      onRetry={onRetryMessage}
      onRetryAuto={onRetryAutoMessage}
      onCompare={onCompareMessage}
      onDelete={onDeleteMessage}
      onTranslate={onTranslateMessage}
      onQuote={onQuoteMessage}
      onFork={onForkMessage}
    />
  );

  return (
    <main className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 md:px-8',
          // 虚拟化项脱离常规文档流：顶部留白折进首项（保持视觉一致），并关闭
          // 浏览器滚动锚定避免与 virtua 自身的位置补偿互相打架。
          virtualized ? '[overflow-anchor:none]' : 'pt-3 md:pt-12',
        )}
      >
        <div className="mx-auto w-full max-w-[820px]">
          {isEmpty ? (
            <EmptyState
              greeting={greeting}
              nickname={nickname}
              onPickPrompt={onPickPrompt}
            />
          ) : virtualized ? (
            <div role="log" aria-label="对话消息" aria-busy={streaming}>
              {/* key=会话 id：切会话时重置 virtua 的按索引尺寸缓存，避免用上
                  一个会话的测量值估算新会话的行高 */}
              <Virtualizer
                key={activeSession?.id ?? 'session'}
                ref={virtualizerRef}
                scrollRef={scrollRef}
                bufferSize={600}
              >
                {messages.map((m, index) => (
                  <div
                    key={m.id}
                    className={cn(
                      // flex gap 在绝对定位的虚拟化行之间失效，折算成行内边距：
                      // 行间距 = 原 gap；末行 pb-6 对应原容器的 pb-6 收尾留白。
                      index === 0 && 'pt-3 md:pt-12',
                      displayMode === 'engraved' && index !== messages.length - 1
                        ? 'pb-2'
                        : 'pb-6',
                    )}
                  >
                    {renderMessageRow(m, {
                      entrance: !seenMessageIdsRef.current.has(m.id),
                      animateLayout: false,
                    })}
                    {activeSession?.contextBreakId === m.id && (
                      <ContextBreakDivider
                        onClear={onClearContextBreak}
                        className={displayMode === 'engraved' ? 'mt-2' : 'mt-6'}
                      />
                    )}
                  </div>
                ))}
              </Virtualizer>
            </div>
          ) : (
            <div
              className={cn(
                'flex flex-col pb-6',
                displayMode === 'engraved' ? 'gap-2' : 'gap-6',
              )}
              role="log"
              aria-label="对话消息"
              aria-busy={streaming}
            >
              {messages.map((m) => (
                <React.Fragment key={m.id}>
                  {renderMessageRow(m, {
                    // 与虚拟化分支同一判定：只有本次挂载期间新追加的消息播
                    // 入场动画，防止 31→30 下穿阈值时整屏历史重放入场动画。
                    entrance: !seenMessageIdsRef.current.has(m.id),
                    animateLayout: true,
                  })}
                  {activeSession?.contextBreakId === m.id && (
                    <ContextBreakDivider onClear={onClearContextBreak} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 用户滚到上方阅读时，浮一个"跳到最新"按钮；点完恢复 stickToBottom */}
      <AnimatePresence>
        {!isEmpty && !stickToBottom && (
          <motion.button
            type="button"
            onClick={scrollToBottom}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] px-3 py-1.5 text-[12px] text-[var(--ink-secondary)] shadow-[var(--hub-card-shadow)] backdrop-blur-2xl transition-colors hover:text-[var(--ink-primary)]"
            aria-label="滚动到最新"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            跳到最新
          </motion.button>
        )}
      </AnimatePresence>

      <Composer
        value={composer}
        onChange={onComposerChange}
        onSend={onSend}
        onAbort={onAbort}
        streaming={streaming}
        modelsState={modelsState}
        activeSession={activeSession}
        onSetModel={onSetModel}
        sendShortcut={sendShortcut}
        onSetSendShortcut={onSetSendShortcut}
        enableTools={enableTools}
        onToggleEnableTools={onToggleEnableTools}
        selectedArticles={selectedArticles}
        selectedTags={selectedTags}
        selectedKbs={selectedKbs}
        selectedAtlasKps={selectedAtlasKps}
        autoKnowledge={autoKnowledge}
        onToggleAutoKnowledge={onToggleAutoKnowledge}
        onPickArticle={onPickArticle}
        onPickTag={onPickTag}
        onPickKb={onPickKb}
        onPickAtlasKp={onPickAtlasKp}
        onRemoveArticle={onRemoveArticle}
        onRemoveTag={onRemoveTag}
        onRemoveKb={onRemoveKb}
        onRemoveAtlasKp={onRemoveAtlasKp}
        onSlashCommand={onSlashCommand}
        attachments={attachments}
        onAddAttachments={onAddAttachments}
        onRemoveAttachment={onRemoveAttachment}
        onToggleContextBreak={onToggleContextBreak}
      />
    </main>
  );
}

/**
 * 上下文断点分隔线 —— 插在被标记消息之后。虚拟化路径下它与消息同属一个
 * 测量单元（间距用 className 传 mt-*），非虚拟化路径下由 flex gap 供间距。
 */
function ContextBreakDivider({
  onClear,
  className,
}: {
  onClear: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'hub-context-break mx-auto flex w-full max-w-3xl items-center justify-center py-1',
        className,
      )}
    >
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--signal-warn)_32%,transparent)] bg-[var(--hub-panel-strong)] px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--signal-warn)] transition-colors hover:bg-[color-mix(in_oklch,var(--signal-warn)_12%,transparent)]"
        title="断点之前的消息不再随请求发送，点击恢复"
      >
        <Scissors className="h-3 w-3" aria-hidden="true" />
        新上下文从这里开始 · 点击恢复
      </button>
    </div>
  );
}

function EmptyState({
  greeting,
  nickname,
  onPickPrompt,
}: {
  greeting: string;
  nickname: string;
  onPickPrompt: (text: string, options?: { needsKnowledge?: boolean }) => void;
}) {
  return (
    <div className="flex flex-col items-center pb-5 pt-[min(7vh,2.75rem)] text-center md:pt-12">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-[1.35rem] bg-[var(--hub-active)] text-[var(--hub-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] md:h-12 md:w-12 md:rounded-2xl">
        <Sparkles className="h-7 w-7" />
      </div>
      <h1 className="font-display text-[2rem] font-semibold leading-tight text-[var(--ink-primary)] sm:text-[2.4rem] md:text-[clamp(1.85rem,8vw,3.25rem)] md:leading-none">
        {greeting}，{nickname}
      </h1>
      <p className="mt-2 max-w-[21rem] text-[14px] leading-6 text-[var(--ink-secondary)] md:mt-3 md:max-w-none md:text-[var(--fs-lede)]">
        输入问题，或点选建议开始。
      </p>

      <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:mt-8 md:gap-3">
        {promptChips.map((chip, index) => (
          <button
            key={chip.text}
            type="button"
            onClick={() => onPickPrompt(chip.text, { needsKnowledge: chip.needsKnowledge })}
            className="group surface-leaf flex min-h-[3.35rem] items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-sm text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink-primary)] md:min-h-0 md:rounded-xl md:px-4"
            data-interactive
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--hub-control)] font-mono text-[10px] tnum text-[var(--ink-muted)] transition-colors group-hover:bg-[var(--hub-active)] group-hover:text-[var(--hub-accent-text)]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="line-clamp-2 min-w-0 flex-1">{chip.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  displayMode,
  streamAnimation,
  fontSize,
  currentUser,
  modelsState,
  busy,
  entrance = true,
  animateLayout = true,
  onEdit,
  onRetry,
  onRetryAuto,
  onCompare,
  onDelete,
  onTranslate,
  onQuote,
  onFork,
}: {
  message: AgentMessage;
  displayMode: DisplayMode;
  streamAnimation: StreamAnimationMode;
  fontSize: number;
  currentUser: CurrentUser;
  modelsState: ReturnType<typeof useAgentModels>;
  busy: boolean;
  /** false = 挂载时不播放入场动画（虚拟化重挂载的历史行） */
  entrance?: boolean;
  /** false = 关闭 framer layout 测量（虚拟化行由 virtua 定位，layout 动画无意义且会打架） */
  animateLayout?: boolean;
  onEdit: (message: AgentMessage) => void;
  onRetry: (message: AgentMessage) => void;
  onRetryAuto: (message: AgentMessage) => void;
  onCompare: (message: AgentMessage) => void;
  onDelete: (message: AgentMessage) => void;
  onTranslate: (message: AgentMessage) => void;
  onQuote: (message: AgentMessage) => void;
  onFork: (message: AgentMessage) => void;
}) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 正文引用标记 [n] 被点击 → 传给回执卡展开并高亮对应命中（nonce 允许连点）。
  const [citeSpotlight, setCiteSpotlight] = useState<{ rank: number; nonce: number } | null>(null);
  const isUser = message.role === 'user';
  const hasThink = !isUser && !!message.think?.trim();
  const showThinkStatus = !isUser && (!!message.pending || hasThink);
  const showTypingDots = !isUser && !!message.pending && !message.content && !message.error && !showThinkStatus;
  const isStreaming = !isUser && !!message.pending && !!message.content;
  const canEdit = isUser && !busy && !!message.content;
  const canRetry = !isUser && !busy && !message.pending && (!!message.content || !!message.error);
  const canDelete = !busy && !message.pending;
  const canTranslate = !isUser && !message.pending && !!message.content;
  const canQuote = !!message.content && !message.pending;
  const canFork = !busy && !message.pending && !!message.content;

  useEffect(() => {
    if (!confirmDelete) return;
    const id = window.setTimeout(() => setConfirmDelete(false), 1800);
    return () => window.clearTimeout(id);
  }, [confirmDelete]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
      toast.success('消息已复制');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  }

  const actions = (
    <MessageActions
      isUser={isUser}
      copied={copied}
      canCopy={!!message.content}
      canEdit={canEdit}
      canRetry={canRetry}
      canCompare={canRetry}
      canDelete={canDelete}
      canTranslate={canTranslate}
      canQuote={canQuote}
      canFork={canFork}
      translated={!!message.translation && !message.translation.pending}
      confirmDelete={confirmDelete}
      onCopy={handleCopy}
      onEdit={() => onEdit(message)}
      onRetry={() => onRetry(message)}
      onCompare={() => onCompare(message)}
      onTranslate={() => onTranslate(message)}
      onQuote={() => onQuote(message)}
      onFork={() => onFork(message)}
      onDelete={() => {
        if (!confirmDelete) {
          setConfirmDelete(true);
          return;
        }
        setConfirmDelete(false);
        onDelete(message);
      }}
    />
  );

  const header =
    displayMode === 'engraved' ? (
      <EngravedHeader message={message} isUser={isUser} currentUser={currentUser} actions={actions} />
    ) : (
      <BubbleHeader message={message} isUser={isUser} currentUser={currentUser} actions={actions} />
    );

  const body = isUser ? (
    <UserContent message={message} displayMode={displayMode} fontSize={fontSize} />
  ) : showTypingDots ? (
    <AssistantSurface displayMode={displayMode} isStreaming={false} hasError={false}>
      <TypingDots />
    </AssistantSurface>
  ) : (
    <AssistantContent
      message={message}
      displayMode={displayMode}
      streamAnimation={streamAnimation}
      fontSize={fontSize}
      isDark={isDark}
      isStreaming={isStreaming}
      showThinkStatus={showThinkStatus}
      onCiteClick={(rank) => setCiteSpotlight({ rank, nonce: Date.now() })}
      onRetry={canRetry ? () => onRetry(message) : undefined}
      onRetryAuto={canRetry ? () => onRetryAuto(message) : undefined}
    />
  );

  return (
    <motion.article
      layout={animateLayout ? 'position' : false}
      initial={entrance ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="group/msg relative mx-auto flex w-full max-w-3xl flex-col"
      aria-label={isUser ? '用户消息' : 'Agent 回复'}
    >
      {header}
      <div className={cn(displayMode === 'bubble' && (isUser ? 'flex justify-end' : 'flex justify-start'))}>
        {body}
      </div>
      {!isUser && message.retrieval && (
        <RetrievalReceiptCard
          receipt={message.retrieval}
          messageId={message.id}
          spotlight={citeSpotlight}
        />
      )}
      {message.sources && message.sources.length > 0 && (
        <div className="mt-3 max-w-full">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            § Sources
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {message.sources.map((s) => (
              <li key={s.slug + s.title}>
                <a
                  href={`/posts/${encodeURIComponent(s.slug)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] px-2.5 py-1 text-[11.5px] text-[var(--ink-secondary)] transition-colors hover:border-[color-mix(in_oklch,var(--aurora-1)_36%,transparent)] hover:text-[var(--ink-primary)]"
                >
                  {s.title || s.slug}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!isUser && !message.pending && !!message.startedAt && (
        <MessageMetaFooter message={message} modelsState={modelsState} />
      )}
      {!isUser && !message.pending && !!message.alternatives?.length && (
        <AlternativeAnswers
          alternatives={message.alternatives}
          modelsState={modelsState}
          isDark={isDark}
          fontSize={fontSize}
        />
      )}
    </motion.article>
  );
}

/**
 * MessageMetaFooter —— 回复完成后的一行元数据：模型 · 首字延迟 · 总用时 ·
 * token 用量（后端 usage 事件的真值不带 ~，估算带 ~）· 成本（有定价才显示）。
 */
function MessageMetaFooter({
  message,
  modelsState,
}: {
  message: AgentMessage;
  modelsState: ReturnType<typeof useAgentModels>;
}) {
  const items = modelsState.status === 'ready' ? modelsState.items : [];
  const model = message.modelId
    ? items.find((m) => m.modelId === message.modelId && m.providerCode === message.providerCode) ?? null
    : null;
  const modelName = message.modelId ? (model ? modelLabel(model) : message.modelId) : '自动路由';
  const totalSec =
    message.finishedAt && message.startedAt
      ? Math.max(0, message.finishedAt - message.startedAt) / 1000
      : null;
  const ttftSec =
    message.firstTokenAt && message.startedAt
      ? Math.max(0, message.firstTokenAt - message.startedAt) / 1000
      : null;
  const usage = message.usage;
  const tokenLabel = usage
    ? `${usage.estimated ? '~' : ''}${formatTokenCount(usage.totalTokens)} tok（${formatTokenCount(usage.promptTokens)}↑ ${formatTokenCount(usage.completionTokens)}↓）`
    : message.content
      ? `~${formatTokenCount(estimateMessagesTokens([message.content]))} tok`
      : null;
  const cost =
    usage && model && model.inputCostPer1M != null && model.outputCostPer1M != null
      ? (usage.promptTokens * model.inputCostPer1M + usage.completionTokens * model.outputCostPer1M) /
        1_000_000
      : null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 font-mono text-[10px] tnum text-[var(--ink-muted)]">
      <span className="max-w-[14rem] truncate" title={modelName}>
        {modelName}
      </span>
      {ttftSec != null && (
        <>
          <span aria-hidden="true">·</span>
          <span>首字 {ttftSec.toFixed(1)}s</span>
        </>
      )}
      {totalSec != null && (
        <>
          <span aria-hidden="true">·</span>
          <span>用时 {totalSec.toFixed(1)}s</span>
        </>
      )}
      {tokenLabel && (
        <>
          <span aria-hidden="true">·</span>
          <span>{tokenLabel}</span>
        </>
      )}
      {cost != null && cost > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span>≈ ${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}</span>
        </>
      )}
    </div>
  );
}

/**
 * AlternativeAnswers —— 多模型对比采纳后存档的其他回答，meta footer 下方
 * 一行小按钮「查看其他 N 个回答」，行内展开每条 alternative 的紧凑卡
 * （模型名 + MarkdownPreview 正文 + token 数 / 用时），再点收起。
 */
function AlternativeAnswers({
  alternatives,
  modelsState,
  isDark,
  fontSize,
}: {
  alternatives: AgentAlternative[];
  modelsState: ReturnType<typeof useAgentModels>;
  isDark: boolean;
  fontSize: number;
}) {
  const [open, setOpen] = useState(false);
  const items = modelsState.status === 'ready' ? modelsState.items : [];
  const labelFor = (alt: AgentAlternative) => {
    if (!alt.modelId) return '自动路由';
    const found = items.find(
      (m) => m.modelId === alt.modelId && m.providerCode === alt.providerCode,
    );
    return found ? modelLabel(found) : alt.modelId;
  };
  return (
    <div className="mt-1.5 px-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-primary)]"
      >
        <Columns2 className="h-3 w-3" aria-hidden="true" />
        {open ? '收起其他回答' : `查看其他 ${alternatives.length} 个回答`}
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="alternatives"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-2">
              {alternatives.map((alt, index) => (
                <div
                  key={`${alt.providerCode ?? 'auto'}:${alt.modelId ?? 'auto'}:${index}`}
                  className="max-w-full rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-3"
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10px] tnum text-[var(--ink-muted)]">
                    <span className="max-w-[14rem] truncate" title={labelFor(alt)}>
                      {labelFor(alt)}
                    </span>
                    {alt.usage && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {alt.usage.estimated ? '~' : ''}
                          {formatTokenCount(alt.usage.totalTokens)} tok
                        </span>
                      </>
                    )}
                    {alt.elapsedMs != null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>用时 {(alt.elapsedMs / 1000).toFixed(1)}s</span>
                      </>
                    )}
                  </div>
                  <MarkdownPreview
                    content={normalizeCjkInlineMarkdown(alt.content)}
                    theme={isDark ? 'dark' : 'light'}
                    className="hub-agent-md leading-relaxed"
                    style={{ fontSize: `${Math.max(12, fontSize - 1)}px` }}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BubbleHeader({
  message,
  isUser,
  currentUser,
  actions,
}: {
  message: AgentMessage;
  isUser: boolean;
  currentUser: CurrentUser;
  actions: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mb-2 flex items-center gap-2',
        isUser ? 'flex-row-reverse self-end' : 'self-start',
      )}
    >
      <Avatar isUser={isUser} currentUser={currentUser} size={28} />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
        {isUser ? 'YOU' : 'AGENT'}
      </span>
      <span aria-hidden="true" className="text-[10.5px] text-[var(--ink-muted)]">
        ·
      </span>
      <span className="tnum font-mono text-[10.5px] text-[var(--ink-muted)]">
        {formatDate(new Date(message.createdAt), 'HH:mm')}
      </span>
      {actions}
    </div>
  );
}

function EngravedHeader({
  message,
  isUser,
  currentUser,
  actions,
}: {
  message: AgentMessage;
  isUser: boolean;
  currentUser: CurrentUser;
  actions: ReactNode;
}) {
  return (
    <div className="my-6 flex items-center gap-3 px-1" aria-label={isUser ? 'YOU' : 'AGENT'}>
      <span
        className="h-px flex-1 bg-gradient-to-r from-transparent to-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
        aria-hidden="true"
      />
      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--ink-muted)]">
        <Avatar isUser={isUser} currentUser={currentUser} size={20} />
        {isUser ? 'YOU' : 'AGENT'}
        <span aria-hidden="true">·</span>
        <span className="tnum normal-case tracking-[0.14em]">
          {formatDate(new Date(message.createdAt), 'HH:mm')}
        </span>
        {actions}
      </span>
      <span
        className="h-px flex-1 bg-gradient-to-l from-transparent to-[color-mix(in_oklch,var(--ink-primary)_18%,transparent)]"
        aria-hidden="true"
      />
    </div>
  );
}

function MessageActions({
  isUser,
  copied,
  canCopy,
  canEdit,
  canRetry,
  canCompare,
  canDelete,
  canTranslate,
  canQuote,
  canFork,
  translated,
  confirmDelete,
  onCopy,
  onEdit,
  onRetry,
  onCompare,
  onTranslate,
  onQuote,
  onFork,
  onDelete,
}: {
  isUser: boolean;
  copied: boolean;
  canCopy: boolean;
  canEdit: boolean;
  canRetry: boolean;
  canCompare: boolean;
  canDelete: boolean;
  canTranslate: boolean;
  canQuote: boolean;
  canFork: boolean;
  translated: boolean;
  confirmDelete: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRetry: () => void;
  onCompare: () => void;
  onTranslate: () => void;
  onQuote: () => void;
  onFork: () => void;
  onDelete: () => void;
}) {
  return (
    <span
      className={cn(
        // hub-touch-show：无 hover 设备（触屏）常显 —— 否则这些操作在手机上不可达。
        'hub-touch-show ml-1 inline-flex items-center gap-2 normal-case tracking-normal opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100',
        isUser && 'flex-row-reverse',
      )}
    >
      {canCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
          aria-label="复制消息"
          title="复制"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> 已复制
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> 复制
            </>
          )}
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
          aria-label="编辑这条消息"
          title="编辑（将截断后续对话）"
        >
          <Pencil className="h-3 w-3" /> 编辑
        </button>
      )}
      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 hover:text-[var(--aurora-1)]"
          aria-label="重试这条回复"
          title="重新生成"
        >
          <RefreshCcw className="h-3 w-3" /> 重试
        </button>
      )}
      {canCompare && (
        <button
          type="button"
          onClick={onCompare}
          className="inline-flex items-center gap-1 hover:text-[var(--aurora-2)]"
          aria-label="多模型对比这条回复"
          title="同一问题并行发给多个模型对比"
        >
          <Columns2 className="h-3 w-3" /> 对比
        </button>
      )}
      {canTranslate && (
        <button
          type="button"
          onClick={onTranslate}
          className={cn(
            'inline-flex items-center gap-1 hover:text-[var(--aurora-3)]',
            translated && 'text-[var(--aurora-3)]',
          )}
          aria-label={translated ? '收起译文' : '翻译这条消息'}
          title={translated ? '收起译文' : '翻译（中 ⇄ 英）'}
        >
          <Languages className="h-3 w-3" /> {translated ? '收起译文' : '翻译'}
        </button>
      )}
      {canQuote && (
        <button
          type="button"
          onClick={onQuote}
          className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
          aria-label="引用到输入框"
          title="引用到输入框"
        >
          <Quote className="h-3 w-3" /> 引用
        </button>
      )}
      {canFork && (
        <button
          type="button"
          onClick={onFork}
          className="inline-flex items-center gap-1 hover:text-[var(--ink-primary)]"
          aria-label="从此处创建分支对话"
          title="从此处创建分支对话"
        >
          <GitFork className="h-3 w-3" /> 分支
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          className={cn(
            'inline-flex items-center gap-1 hover:text-[var(--signal-danger)]',
            confirmDelete && 'text-[var(--signal-danger)]',
          )}
          aria-label={confirmDelete ? '确认删除这条及后续消息' : '删除这条及后续消息'}
          title={confirmDelete ? '再次点击确认删除' : '删除这条及后续消息'}
        >
          <Trash2 className="h-3 w-3" /> {confirmDelete ? '确认删除' : '删除'}
        </button>
      )}
    </span>
  );
}

function markdownToPreviewText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^[>\s-]*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function Avatar({
  isUser,
  currentUser,
  size,
}: {
  isUser: boolean;
  currentUser: CurrentUser;
  size: number;
}) {
  if (isUser && currentUser.avatarUrl) {
    return (
      <CachedAvatar
        src={currentUser.avatarUrl}
        alt={currentUser.nickname}
        className="rounded-full object-cover"
        style={{ height: size, width: size }}
        fallback={
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-primary)]"
            style={{ height: size, width: size }}
            aria-hidden="true"
          >
            <UserIcon style={{ width: size * 0.5, height: size * 0.5 }} />
          </span>
        }
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        isUser
          ? 'border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-primary)]'
          : 'bg-[color-mix(in_oklch,var(--aurora-1)_14%,transparent)] text-[var(--aurora-1)]',
      )}
      style={{ height: size, width: size }}
      aria-hidden="true"
    >
      {isUser ? (
        <UserIcon style={{ width: size * 0.5, height: size * 0.5 }} />
      ) : (
        <Sparkles style={{ width: size * 0.55, height: size * 0.55 }} />
      )}
    </span>
  );
}

/**
 * 单张附件图片的三态渲染：
 *   1. 内存缓存（或消息自带 dataUrl）命中 → 同步显示；
 *   2. 未命中 → 骨架占位 + 异步查 IndexedDB，取到后显示并回填内存缓存
 *      —— 虚拟化列表滚出重挂载时，回填过的缓存让重挂载直接走同步路径
 *      （回填有 LRU 上限，见 writeAttachmentCache）；
 *   3. IndexedDB 也没有（已清理 / 隐私模式）→ 占位卡片。
 * 点击图片 → 请求页面级大图预览（状态不在本组件，否则会随虚拟化卸载而丢）。
 */
function AttachmentImage({ attachment }: { attachment: AgentAttachment }) {
  const [url, setUrl] = useState(
    () => attachment.dataUrl || readAttachmentCache(attachment.id) || '',
  );
  const [idbChecked, setIdbChecked] = useState(false);
  const requestPreview = useContext(AttachmentPreviewContext);

  useEffect(() => {
    if (url) return;
    let cancelled = false;
    void getAttachmentData(attachment.id).then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) {
        writeAttachmentCache(attachment.id, dataUrl);
        setUrl(dataUrl);
      } else {
        setIdbChecked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, url]);

  if (!url) {
    // IndexedDB 查询在途 → 骨架（禁 spinner，红线）；确认无原图 → 占位卡片。
    return idbChecked ? (
      <span
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[var(--hub-border)] bg-[var(--hub-control)] px-3 text-[11px] text-[var(--ink-muted)]"
        title="原图本地缓存不可用（可能已被清理，或浏览器隐私模式未持久化）"
      >
        <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
        {attachment.name}（原图缓存已失效）
      </span>
    ) : (
      <span
        className="h-28 w-28 animate-pulse rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)]"
        aria-hidden="true"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => requestPreview?.({ src: url, name: attachment.name })}
      className="overflow-hidden rounded-xl border border-[var(--hub-border)] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)]"
      title={`点击查看大图：${attachment.name}`}
      aria-label={`查看大图：${attachment.name}`}
    >
      <img src={url} alt={attachment.name} className="h-28 max-w-[13rem] object-cover" />
    </button>
  );
}

/**
 * 附件大图预览浮层 —— 页面级单例，渲染在虚拟化列表之外。
 *
 * 不复用 @aetherblog/ui 的 Modal：它没有 role="dialog"、没有焦点管理，Esc 也
 * 没有 IME 守卫；而本浮层的写法与 CompareOverlay / SpacePreviewDialog 一致，
 * 焦点行为统一交给 useModalDialog（移入焦点 / Tab 陷阱 / 关闭还原焦点 /
 * Esc 跳过输入法组合态）。
 */
function AttachmentPreviewOverlay({
  target,
  onClose,
}: {
  target: AttachmentPreviewTarget;
  onClose: () => void;
}) {
  const dialogRef = useModalDialog<HTMLElement>({ onClose });
  const reduceMotion = useReducedMotion();

  return (
    <div className="fixed inset-0 z-[80]">
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <motion.section
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`附件大图：${target.name}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 430, damping: 34, mass: 0.8 }
          }
          className="surface-overlay flex max-h-[92vh] w-[min(960px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[26px] border outline-none backdrop-blur-2xl"
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--hub-border)] px-5">
            <h3 className="min-w-0 truncate text-sm font-semibold text-[var(--ink-primary)]">
              {target.name}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭大图"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="agent-thumb-scroll min-h-0 flex-1 overflow-auto p-5">
            <img
              src={target.src}
              alt={target.name}
              className="mx-auto max-h-[74vh] max-w-full object-contain"
            />
          </div>
        </motion.section>
      </div>
    </div>
  );
}

/** 用户消息里的图片附件条 —— 三态渲染细节见 AttachmentImage。 */
function UserAttachments({
  attachments,
  align,
}: {
  attachments: AgentAttachment[];
  align: 'end' | 'center';
}) {
  return (
    <div
      className={cn(
        'mb-2 flex max-w-full flex-wrap gap-2',
        align === 'end' ? 'justify-end' : 'justify-center',
      )}
    >
      {attachments.map((a) => (
        <AttachmentImage key={a.id} attachment={a} />
      ))}
    </div>
  );
}

function UserContent({
  message,
  displayMode,
  fontSize,
}: {
  message: AgentMessage;
  displayMode: DisplayMode;
  fontSize: number;
}) {
  const attachments = message.attachments ?? [];
  if (displayMode === 'engraved') {
    return (
      <div className="mx-auto max-w-full">
        {attachments.length > 0 && <UserAttachments attachments={attachments} align="center" />}
        <div
          className="hub-engraved-text mx-auto max-w-full whitespace-pre-wrap leading-[1.85] text-[var(--ink-primary)]"
          style={{ fontSize: `${fontSize + 1}px` }}
        >
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex max-w-[85%] flex-col items-end">
      {attachments.length > 0 && <UserAttachments attachments={attachments} align="end" />}
      <div
        className="inline-block max-w-full rounded-2xl border border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] px-4 py-3 leading-relaxed text-[var(--ink-primary)] whitespace-pre-wrap break-words"
        style={{ fontSize: `${fontSize}px` }}
      >
        {message.content}
      </div>
    </div>
  );
}

function AssistantSurface({
  children,
  displayMode,
  isStreaming,
  hasError,
}: {
  children: ReactNode;
  displayMode: DisplayMode;
  isStreaming: boolean;
  hasError: boolean;
}) {
  if (displayMode === 'engraved') {
    return (
      <div
        className={cn(
          'hub-engraved-text mx-auto max-w-full text-[15.5px] leading-[1.85] text-[var(--ink-primary)]',
          isStreaming && 'hub-engraved-streaming',
        )}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'inline-block max-w-full break-words rounded-2xl px-4 py-3 text-[14.5px] leading-relaxed',
        hasError
          ? 'whitespace-pre-wrap border border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_8%,transparent)] text-[var(--ink-primary)]'
          : isStreaming
            ? 'surface-leaf hub-bubble-pending border border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] text-[var(--ink-primary)]'
            : 'surface-leaf border border-[var(--hub-border)] text-[var(--ink-primary)]',
      )}
    >
      {children}
    </div>
  );
}

function AssistantContent({
  message,
  displayMode,
  streamAnimation,
  fontSize,
  isDark,
  isStreaming,
  showThinkStatus,
  onCiteClick,
  onRetry,
  onRetryAuto,
}: {
  message: AgentMessage;
  displayMode: DisplayMode;
  streamAnimation: StreamAnimationMode;
  fontSize: number;
  isDark: boolean;
  isStreaming: boolean;
  showThinkStatus: boolean;
  onCiteClick: (rank: number) => void;
  onRetry?: () => void;
  onRetryAuto?: () => void;
}) {
  // 吐字平滑由页面级 rAF 管线完成（message.content 已是节流后的值），这里
  // 不再叠第二层 typewriter —— 双管线互相竞争正是历史卡顿的根因。
  // CJK 预处理修正 `**xx：**汉字` 的 flanking 失败；再把 [n] 链接到回执命中。
  const maxRank = message.retrieval?.hits.length ?? 0;
  const renderableContent = useMemo(() => {
    const normalized = normalizeCjkInlineMarkdown(message.content);
    return maxRank > 0 ? linkifyCitations(normalized, message.id, maxRank) : normalized;
  }, [message.content, message.id, maxRank]);

  // 引用标记点击：markdown 是 innerHTML 渲染，onClick 委托到容器上拦 #cite-。
  const handleContentClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('#cite-')) return;
      event.preventDefault();
      const rank = parseCitationRank(href);
      if (rank != null) onCiteClick(rank);
    },
    [onCiteClick],
  );

  const translation = message.translation;
  const showErrorActions =
    !message.pending && !!message.error && (message.retryable || !!message.errorCode);

  return (
    <div className="w-full">
      {showThinkStatus && (
        <div className={cn(displayMode === 'engraved' && 'mx-auto mb-3 max-w-full')}>
          <ThinkingPanel
            message={message}
            isDark={isDark}
            fontSize={fontSize}
            streamAnimation={streamAnimation}
          />
        </div>
      )}
      {message.toolEvents && message.toolEvents.length > 0 && (
        <div
          className={cn(
            'mb-2.5 flex max-w-full flex-col gap-2',
            displayMode === 'engraved' && 'mx-auto',
          )}
        >
          {message.toolEvents.map((event) => (
            <ToolCallCard key={event.id} event={event} messagePending={!!message.pending} />
          ))}
        </div>
      )}
      <AssistantSurface
        displayMode={displayMode}
        isStreaming={isStreaming}
        hasError={!!message.error}
      >
        {message.error && !message.content ? (
          <div className="font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
            ERROR · {message.error}
          </div>
        ) : message.pending && !message.content ? (
          <TypingDots />
        ) : (
          <>
            <div
              className={cn(
                'hub-stream-fade',
                streamAnimation === 'fade' && 'hub-stream-fade--fade',
                streamAnimation === 'smooth' && 'hub-stream-fade--smooth',
              )}
              style={{ fontSize: `${fontSize}px` }}
              onClick={handleContentClick}
            >
              {message.pending ? (
                // 流式期间用轻渲染器：不引 shiki/KaTeX/mermaid（每帧全文重
                // parse，重型管线会把主线程吃满且半截公式/图会闪烁），并内置
                // 未闭合围栏稳定化，代码块单调生长、滚动不再乱窜。
                <MarkdownStreamPreview
                  content={renderableContent}
                  className={cn(
                    'hub-agent-md leading-relaxed',
                    displayMode === 'engraved' && 'hub-engraved-md',
                  )}
                />
              ) : (
                <MarkdownPreview
                  content={renderableContent}
                  theme={isDark ? 'dark' : 'light'}
                  className={cn(
                    'hub-agent-md leading-relaxed',
                    displayMode === 'engraved' && 'hub-engraved-md',
                  )}
                  style={{ fontSize: `${fontSize}px` }}
                />
              )}
            </div>
            {message.pending && (
              <span
                className="hub-caret text-[var(--aurora-1)]"
                aria-hidden="true"
                style={{ marginTop: '-1.05em' }}
              />
            )}
            {message.error && (
              <div className="mt-3 font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
                ERROR · {message.error}
              </div>
            )}
          </>
        )}
        {showErrorActions && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {message.errorCode === 'selected_context_not_grounded' && onRetryAuto && (
              <button
                type="button"
                onClick={onRetryAuto}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color-mix(in_oklch,var(--aurora-1)_36%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] px-2.5 text-[12px] font-medium text-[var(--aurora-1)] transition-colors hover:bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)]"
              >
                <Sparkles className="h-3 w-3" />
                改用自动检索重试
              </button>
            )}
            {message.retryable && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] px-2.5 text-[12px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              >
                <RefreshCcw className="h-3 w-3" />
                重试
              </button>
            )}
          </div>
        )}
      </AssistantSurface>

      {/* 内联译文面板 —— 流式期间轻渲染器，完成后交回全量渲染。 */}
      {translation && (
        <div className="mt-2 max-w-full rounded-xl border border-[color-mix(in_oklch,var(--aurora-3)_26%,transparent)] bg-[color-mix(in_oklch,var(--aurora-3)_5%,transparent)] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            <Languages className="h-3 w-3 text-[var(--aurora-3)]" aria-hidden="true" />
            {translation.lang === 'en' ? '译文 · English' : '译文 · 中文'}
            {translation.pending && <span className="hub-think-live-dot" aria-label="翻译中" />}
          </div>
          {translation.content ? (
            translation.pending ? (
              <MarkdownStreamPreview
                content={normalizeCjkInlineMarkdown(translation.content)}
                className="hub-agent-md leading-relaxed"
              />
            ) : (
              <MarkdownPreview
                content={normalizeCjkInlineMarkdown(translation.content)}
                theme={isDark ? 'dark' : 'light'}
                className="hub-agent-md leading-relaxed"
                style={{ fontSize: `${fontSize}px` }}
              />
            )
          ) : translation.pending ? (
            <TypingDots />
          ) : null}
          {translation.error && (
            <div className="mt-2 font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
              {translation.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ThinkingPanel —— 后台灵境与前台一致的独立思考面板。
 * 流式中自动展开并跟随底部；完成后若用户没有手动操作，会收回为摘要条。
 */
function ThinkingPanel({
  message,
  isDark,
  fontSize,
  streamAnimation,
}: {
  message: AgentMessage;
  isDark: boolean;
  fontSize: number;
  streamAnimation: StreamAnimationMode;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [open, setOpen] = useState(false);
  const userToggledRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const isStreaming = !!message.pending;
  // 吐字节流已在页面级 rAF 管线完成（message.think 就是节流后的值），这里
  // 直接渲染 —— 旧版在此再叠一层 useSmoothStream，与主管线互相竞争。
  const think = message.think ?? '';
  const hasThink = !!think.trim();
  const expandable = hasThink;
  const renderableThink = useMemo(
    () => normalizeCjkInlineMarkdown(think),
    [think],
  );
  const tail = useMemo(() => {
    const trimmed = markdownToPreviewText(think);
    if (!trimmed) return '';
    if (trimmed.length <= 86) return trimmed;
    return `${trimmed.slice(0, 86)}…`;
  }, [think]);

  useEffect(() => {
    if (!message.pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [message.pending]);

  useEffect(() => {
    if (!hasThink || userToggledRef.current) return;
    if (isStreaming) {
      setOpen(true);
      return;
    }
    const id = window.setTimeout(() => setOpen(false), 520);
    return () => window.clearTimeout(id);
  }, [hasThink, isStreaming]);

  useLayoutEffect(() => {
    if (!open || !isStreaming || !expandable) return;
    const el = previewRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, isStreaming, expandable, think]);

  if (!message.startedAt) return null;

  const endTs = isStreaming ? now : (message.finishedAt ?? message.startedAt);
  const elapsed = Math.max(0, endTs - message.startedAt) / 1000;
  const elapsedStr = `${elapsed.toFixed(1)} 秒`;
  const charCount = think.length;

  let label: string;
  if (isStreaming && hasThink && !message.firstTokenAt) label = '正在思考';
  else if (isStreaming && !message.firstTokenAt) label = '等待响应';
  else if (isStreaming) label = '正在生成';
  else if (message.error) label = '已中断';
  else if (hasThink) label = '已深度思考';
  else label = '已生成';

  const headerClass = cn(
    'group/think relative flex w-full items-center gap-2 overflow-hidden rounded-xl border py-2.5 pl-3 pr-2.5 text-left transition-[border-color,background-color,box-shadow]',
    isStreaming
      ? 'border-[color-mix(in_oklch,var(--aurora-1)_26%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_7%,transparent)] shadow-[0_12px_28px_-24px_rgba(0,0,0,0.35)]'
      : message.error
        ? 'border-[color-mix(in_oklch,var(--signal-warn)_22%,transparent)] bg-[color-mix(in_oklch,var(--signal-warn)_6%,transparent)]'
        : 'border-[var(--hub-border)] bg-[var(--hub-control)] hover:border-[color-mix(in_oklch,var(--aurora-1)_30%,transparent)]',
    !expandable && 'cursor-default',
  );

  const headerContent = (
    <>
      {isStreaming && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[1.5px] bg-[color-mix(in_oklch,var(--aurora-1)_55%,transparent)]"
        >
          <span className="hub-think-shimmer" />
        </span>
      )}
      <span
        className={cn(
          'grid h-6 w-6 shrink-0 place-items-center rounded-lg',
          isStreaming
            ? 'bg-[color-mix(in_oklch,var(--aurora-1)_18%,transparent)] text-[var(--aurora-1)]'
            : message.error
              ? 'bg-[color-mix(in_oklch,var(--signal-warn)_14%,transparent)] text-[var(--signal-warn)]'
              : 'bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-[var(--ink-muted)]',
        )}
        aria-hidden="true"
      >
        <Brain className="h-3.5 w-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-[12px] font-medium',
            isStreaming
              ? 'text-[var(--aurora-1)]'
              : message.error
                ? 'text-[var(--signal-warn)]'
                : 'text-[var(--ink-secondary)]',
          )}
        >
          {label}
        </span>
        {isStreaming && (
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_9%,transparent)] px-2 text-[10.5px] text-[var(--aurora-1)]">
            <span className="hub-think-live-dot" aria-hidden="true" />
            实时
          </span>
        )}
        {!open && tail && (
          <span className="hidden min-w-[8rem] max-w-[min(44vw,34rem)] flex-1 truncate text-[12px] text-[var(--ink-muted)] sm:inline">
            {tail}
          </span>
        )}
      </span>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] tnum text-[var(--ink-muted)]">
        <span className="whitespace-nowrap">用时 {elapsedStr}</span>
        {hasThink && (
          <>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">{charCount} 字符</span>
          </>
        )}
      </span>
      {expandable && (
        <span className="shrink-0 text-[var(--ink-muted)]">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      )}
    </>
  );

  return (
    <div className="relative mb-2.5 max-w-full">
      {expandable ? (
        <button
          type="button"
          onClick={() => {
            userToggledRef.current = true;
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className={headerClass}
        >
          {headerContent}
        </button>
      ) : (
        <div className={headerClass} aria-live={isStreaming ? 'polite' : undefined}>
          {headerContent}
        </div>
      )}

      <AnimatePresence initial={false}>
        {expandable && open && (
          <motion.div
            key="think-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div
              ref={previewRef}
              className={cn(
                'hub-think-scroll mt-2 max-h-[min(340px,42vh)] overflow-y-auto rounded-xl border p-3.5',
                isStreaming
                  ? 'border-[color-mix(in_oklch,var(--aurora-1)_24%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_5%,var(--hub-control))]'
                  : 'border-[var(--hub-border)] bg-[var(--hub-control)]',
              )}
            >
              {isStreaming ? (
                // 思考段流式期间同样走轻渲染器 —— 重型管线每帧重 parse 是
                // 历史卡顿的一半来源（另一半是双 typewriter）。
                <MarkdownStreamPreview
                  content={renderableThink}
                  className={cn(
                    'hub-think-md hub-stream-fade leading-relaxed',
                    streamAnimation === 'fade' && 'hub-stream-fade--fade',
                    streamAnimation === 'smooth' && 'hub-stream-fade--smooth',
                  )}
                />
              ) : (
                <MarkdownPreview
                  content={renderableThink}
                  theme={isDark ? 'dark' : 'light'}
                  className="hub-think-md leading-relaxed"
                  style={{ fontSize: `${fontSize}px` }}
                />
              )}
              {isStreaming && (
                <span className="hub-caret text-[var(--aurora-1)]" aria-hidden="true" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 工具名 → 中文标签与图标（服务端白名单外的未知工具兜底扳手 + 原名）。 */
const TOOL_CALL_META: Record<string, { label: string; icon: ElementType }> = {
  search_posts: { label: '检索站内文章', icon: FileSearch },
  search_knowledge_base: { label: '检索知识库', icon: BookOpen },
};

/**
 * ToolCallCard —— 单次工具调用的可折叠卡片（ThinkingPanel 的姊妹件，accent
 * 用 --aurora-2 与思考面板的 aurora-1 区分）。流式中默认收起只看头部状态，
 * 失败卡自动展开；展开体 = 参数（尝试 pretty-print JSON，失败原样）+ 结果
 * （<pre> 原样，服务端已截断 ≤2000 字符）。
 */
function ToolCallCard({
  event,
  messagePending,
}: {
  event: AgentToolEvent;
  messagePending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const userToggledRef = useRef(false);
  // 尊重系统「减少动态效果」：展开改为瞬时（同 PR 的 CSS 动效都做了同款降级）。
  const reduceMotion = useReducedMotion();
  const failed = event.isError === true;
  // finishedAt 缺失 + 消息已定格 = 流被中断（abort / 关页恢复），不再呼吸。
  const running = event.finishedAt === undefined && messagePending;
  const interrupted = event.finishedAt === undefined && !messagePending;

  // 失败卡自动展开（用户手动折叠过则尊重用户）。
  useEffect(() => {
    if (failed && !userToggledRef.current) setOpen(true);
  }, [failed]);

  const meta = TOOL_CALL_META[event.name];
  const Icon = meta?.icon ?? Wrench;
  const label = meta?.label ?? event.name;

  const prettyArgs = useMemo(() => {
    if (!event.arguments) return '';
    try {
      return JSON.stringify(JSON.parse(event.arguments), null, 2);
    } catch {
      return event.arguments; // 非法 JSON 原样展示，不猜测
    }
  }, [event.arguments]);

  const elapsed =
    event.finishedAt !== undefined
      ? Math.max(0, event.finishedAt - event.startedAt) / 1000
      : null;

  return (
    <div className="max-w-full">
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 overflow-hidden rounded-xl border py-2 pl-3 pr-2.5 text-left transition-[border-color,background-color]',
          running
            ? 'border-[color-mix(in_oklch,var(--aurora-2)_26%,transparent)] bg-[color-mix(in_oklch,var(--aurora-2)_7%,transparent)]'
            : failed
              ? 'border-[color-mix(in_oklch,var(--signal-danger)_26%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_6%,transparent)]'
              : 'border-[var(--hub-border)] bg-[var(--hub-control)] hover:border-[color-mix(in_oklch,var(--aurora-2)_30%,transparent)]',
        )}
      >
        <span
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-lg',
            running
              ? 'bg-[color-mix(in_oklch,var(--aurora-2)_18%,transparent)] text-[var(--aurora-2)]'
              : failed
                ? 'bg-[color-mix(in_oklch,var(--signal-danger)_14%,transparent)] text-[var(--signal-danger)]'
                : 'bg-[color-mix(in_oklch,var(--ink-primary)_6%,transparent)] text-[var(--ink-muted)]',
          )}
          aria-hidden="true"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'shrink-0 whitespace-nowrap text-[12px] font-medium',
              running
                ? 'text-[var(--aurora-2)]'
                : failed
                  ? 'text-[var(--signal-danger)]'
                  : 'text-[var(--ink-secondary)]',
            )}
          >
            {label}
          </span>
          <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.06em] text-[var(--ink-muted)] sm:inline">
            {event.name}
          </span>
          {running && (
            <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--aurora-2)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-2)_9%,transparent)] px-2 text-[10.5px] text-[var(--aurora-2)]">
              <span className="hub-think-live-dot" aria-hidden="true" />
              进行中
            </span>
          )}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center font-mono text-[10.5px] tnum">
          {failed ? (
            <span className="whitespace-nowrap text-[var(--signal-danger)]">调用失败</span>
          ) : interrupted ? (
            <span className="whitespace-nowrap text-[var(--ink-muted)]">已中断</span>
          ) : elapsed !== null ? (
            <span className="whitespace-nowrap text-[var(--ink-muted)]">耗时 {elapsed.toFixed(1)}s</span>
          ) : null}
        </span>
        <span className="shrink-0 text-[var(--ink-muted)]" aria-hidden="true">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="tool-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-2.5 rounded-xl border border-[color-mix(in_oklch,var(--aurora-2)_18%,transparent)] bg-[color-mix(in_oklch,var(--aurora-2)_4%,var(--hub-control))] p-3">
              <div>
                <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  参数
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--ink-secondary)]">
                  {prettyArgs || '（无参数）'}
                </pre>
              </div>
              {event.result !== undefined && (
                <div>
                  <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    结果
                  </div>
                  <pre
                    className={cn(
                      'max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed',
                      failed ? 'text-[var(--signal-danger)]' : 'text-[var(--ink-secondary)]',
                    )}
                  >
                    {event.result}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * TypingDots —— 三点 typing 指示器（漂浮 + 缩放 + 透明度复合呼吸）
 */
function TypingDots() {
  return (
    <span className="relative inline-flex items-center gap-1.5 px-0.5 py-1 text-[var(--aurora-1)]">
      <span
        aria-hidden="true"
        className="absolute -inset-3 rounded-full opacity-60 blur-md"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklch, var(--aurora-1) 30%, transparent), transparent)',
        }}
      />
      <span className="hub-dot relative" />
      <span className="hub-dot relative" style={{ animationDelay: '0.16s' }} />
      <span className="hub-dot relative" style={{ animationDelay: '0.32s' }} />
    </span>
  );
}

// =============================================================================
// 多模型对比浮层 —— 同一问题并行发给 2-3 个模型，分栏流式对比，采纳一条
// =============================================================================

/**
 * CompareOverlay —— surface-overlay 全屏浮层（浮层写法对齐 SpacePreviewDialog）。
 *
 * 并发独立性：每列自己的 streamAgentChat + AbortController，列状态只活在
 * 浮层本地（liveRef 为真值、rAF 合并刷进 columns state），不写会话消息、
 * 不占用会话级 streamingIds；关闭浮层（Esc / 遮罩 / 按钮 / 卸载）= 全部 abort。
 * 请求 = 重试同款重放（snapshot 的知识契约 + 断点切片 + 预算裁剪），仅覆盖
 * modelId/providerCode；modelParams 按各列模型重建（跨模型透传会话参数可能
 * 400）；enableTools 不带 —— 对比场景关工具，降低变量。
 */
function CompareOverlay({
  target,
  modelsState,
  onClose,
  onAdopt,
}: {
  target: CompareTarget;
  modelsState: ReturnType<typeof useAgentModels>;
  onClose: () => void;
  onAdopt: (adopted: CompareColumn, archived: CompareColumn[]) => void;
}) {
  const items = modelsState.status === 'ready' ? modelsState.items : [];
  const [query, setQuery] = useState('');
  // 默认预勾当前会话模型（自动路由 / 模型已下架时为空勾）。
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>();
    if (target.sessionModelId) {
      initial.add(`${target.sessionProviderCode}::${target.sessionModelId}`);
    }
    return initial;
  });
  const [columns, setColumns] = useState<CompareColumn[]>([]);
  const running = columns.length > 0;

  // 列状态真值：liveRef 里就地累加，rAF 合并成 columns 快照供渲染 ——
  // 3 路并行流每个 delta 都 setState 会把浮层打成高频重渲染。
  const liveRef = useRef<Map<string, CompareColumn>>(new Map());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const rafRef = useRef(0);

  const flushColumns = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setColumns(Array.from(liveRef.current.values()).map((col) => ({ ...col })));
  }, []);
  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setColumns(Array.from(liveRef.current.values()).map((col) => ({ ...col })));
    });
  }, []);

  const abortAll = useCallback(() => {
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  // 关闭浮层 = 全部 abort；组件卸载兜底同款清理（AnimatePresence 退场后触发）。
  const requestClose = useCallback(() => {
    abortAll();
    onClose();
  }, [abortAll, onClose]);
  useEffect(() => abortAll, [abortAll]);

  // 焦点管理交给 useModalDialog：移入初始焦点 / Tab 焦点陷阱 / 关闭还原焦点 /
  // Esc 关闭且跳过 IME 组合态。此前这里只有一个裸 Esc 监听，却照样声明了
  // role="dialog" aria-modal="true" —— 读屏器按语义认为窗外内容已惰性化，实际
  // Tab 依旧能走出去；而中文输入法按 Esc 取消候选词会连带把浮层（含已勾选的
  // 模型）一起关掉。
  const dialogRef = useModalDialog<HTMLElement>({ onClose: requestClose });
  const reduceMotion = useReducedMotion();

  // 流式中的用时 tick（250ms 足够，展示精度 0.1s）。
  const anyStreaming = columns.some((c) => c.status === 'streaming');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [anyStreaming]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.providerCode, item.providerName, item.modelId, item.displayName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  // 已勾模型以清单为准 —— 预勾的会话模型不在清单里（已下架）时不计数。
  const chosenModels = useMemo(
    () => items.filter((m) => selectedKeys.has(compareModelKey(m))),
    [items, selectedKeys],
  );
  const chosenCount = chosenModels.length;
  // 对比不走 handleSend，得自己拦：勾选项直接取自 items，重拉期间可能勾到刚被
  // 停用的模型。
  const catalogRevalidating = isModelCatalogRevalidating(modelsState);
  const canStart =
    !running &&
    !catalogRevalidating &&
    chosenCount >= COMPARE_MIN_MODELS &&
    chosenCount <= COMPARE_MAX_MODELS;

  const toggleModel = (model: AgentModelItem) => {
    const key = compareModelKey(model);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (chosenCount >= COMPARE_MAX_MODELS) return prev; // 超过 3 个禁勾
        next.add(key);
      }
      return next;
    });
  };

  const startCompare = () => {
    if (!canStart) return;
    const contextPayload = resolveAetherHubKnowledgeContext(
      target.requestSnapshot.knowledgeContext,
      [],
      [],
    );
    if (!contextPayload.ok) {
      toast.error(contextPayload.error.message);
      return;
    }
    // 与 handleSend 重放路径同款：断点切片 + 后端硬限预算裁剪。
    const contextMessages = sliceContextMessages(target.baseMessages, target.contextBreakId);
    const budget = budgetHistory([
      ...contextMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: target.question },
    ]);

    for (const model of chosenModels) {
      const key = compareModelKey(model);
      const startedAt = Date.now();
      const controller = new AbortController();
      controllersRef.current.set(key, controller);
      liveRef.current.set(key, {
        key,
        model,
        status: 'streaming',
        content: '',
        think: '',
        startedAt,
      });

      const req: ChatStreamRequest = {
        sessionId: target.sessionId,
        mode: 'chat',
        messages: budget.history,
        modelId: model.modelId,
        providerCode: model.providerCode,
        modelParams: buildModelParamsForRequest(model, target.sessionModelParams),
        articleIds: target.requestSnapshot.articleIds,
        tagSlugs: target.requestSnapshot.tagSlugs,
        ...contextPayload.value,
      };
      const patch = (mutate: (col: CompareColumn) => void, immediate = false) => {
        const col = liveRef.current.get(key);
        if (!col) return;
        mutate(col);
        if (immediate) flushColumns();
        else scheduleFlush();
      };
      void streamAgentChat(
        req,
        {
          onDelta: (chunk) =>
            patch((col) => {
              if (col.status !== 'streaming') return;
              if (col.firstTokenAt === undefined) col.firstTokenAt = Date.now();
              col.content += chunk;
            }),
          onThink: (chunk) =>
            patch((col) => {
              if (col.status !== 'streaming') return;
              col.think += chunk;
            }),
          onUsage: (usage) =>
            patch((col) => {
              col.usage = usage;
            }),
          onDone: () =>
            patch((col) => {
              if (col.status !== 'streaming') return;
              col.status = 'done';
              col.finishedAt = Date.now();
            }, true),
          onError: (message) =>
            patch((col) => {
              if (col.status !== 'streaming') return;
              col.status = 'error';
              col.error = message;
              col.finishedAt = Date.now();
            }, true),
        },
        controller.signal,
      )
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          patch((col) => {
            if (col.status !== 'streaming') return;
            col.status = 'error';
            col.error = err instanceof Error ? err.message : '请求失败';
            col.finishedAt = Date.now();
          }, true);
        })
        .finally(() => {
          controllersRef.current.delete(key);
        });
    }
    flushColumns();
  };

  const handleAdoptColumn = (column: CompareColumn) => {
    if (column.status !== 'done' || column.error || !column.content.trim()) return;
    // 其余完成且非空的列进存档（liveRef 为真值，避免快照落后一帧）。
    const archived = Array.from(liveRef.current.values()).filter(
      (c) => c.key !== column.key && c.status === 'done' && !c.error && c.content.trim() !== '',
    );
    abortAll();
    onAdopt(column, archived);
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-5">
        <motion.section
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="多模型对比"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 430, damping: 34, mass: 0.8 }
          }
          className={cn(
            'surface-overlay flex max-h-[92vh] flex-col overflow-hidden rounded-[26px] border outline-none backdrop-blur-2xl',
            running ? 'w-[min(1180px,calc(100vw-1.5rem))]' : 'w-[min(560px,calc(100vw-1.5rem))]',
          )}
        >
          <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--hub-border)] px-4 py-2.5 sm:px-5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklch,var(--aurora-2)_14%,transparent)] text-[var(--aurora-2)]">
              <Columns2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-[var(--ink-primary)]">多模型对比</h3>
              <p
                className="mt-0.5 truncate text-[11.5px] text-[var(--ink-muted)]"
                title={target.question}
              >
                {target.question}
              </p>
            </div>
            {!running && (
              <button
                type="button"
                onClick={startCompare}
                disabled={!canStart}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold transition-colors',
                  canStart
                    ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
                    : 'cursor-not-allowed bg-[var(--hub-control)] text-[var(--ink-muted)]',
                )}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                开始对比
              </button>
            )}
            <button
              type="button"
              onClick={requestClose}
              aria-label="关闭对比"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!running ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--hub-border)] px-4 py-2.5 sm:px-5">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]"
                    aria-hidden="true"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索模型或厂商…"
                    aria-label="搜索模型"
                    className="h-9 w-full rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] pl-9 pr-3 text-[13px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklch,var(--aurora-1)_40%,transparent)]"
                  />
                </div>
                <span className="shrink-0 font-mono text-[10.5px] tnum uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  已选 {chosenCount}/{COMPARE_MAX_MODELS}
                </span>
              </div>
              <div className="agent-thumb-scroll min-h-[14rem] flex-1 overflow-y-auto p-2 sm:p-3">
                {modelsState.status === 'loading' && (
                  <div className="space-y-2 px-2 py-3" aria-label="加载模型清单">
                    <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--hub-control-hover)]" />
                    <div className="h-11 animate-pulse rounded-2xl bg-[var(--hub-control)]" />
                    <div className="h-11 animate-pulse rounded-2xl bg-[var(--hub-control)]" />
                    <div className="h-11 animate-pulse rounded-2xl bg-[var(--hub-control)]" />
                  </div>
                )}
                {modelsState.status === 'error' && (
                  <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
                    加载失败：{modelsState.message}
                  </div>
                )}
                {modelsState.status === 'ready' && filteredItems.length === 0 && (
                  <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--ink-muted)]">
                    {query.trim() ? '没有匹配的模型' : '没有已启用的模型，去 AI 配置页添加'}
                  </div>
                )}
                {filteredItems.map((m) => {
                  const key = compareModelKey(m);
                  const checked = selectedKeys.has(key);
                  const full = !checked && chosenCount >= COMPARE_MAX_MODELS;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleModel(m)}
                      disabled={full}
                      role="checkbox"
                      aria-checked={checked}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors',
                        checked
                          ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                          : 'text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)]',
                        full && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
                          checked
                            ? 'border-transparent bg-[var(--aurora-1)] text-[var(--hub-on-accent)]'
                            : 'border-[var(--hub-border)] bg-[var(--hub-control)] text-transparent',
                        )}
                        aria-hidden="true"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{modelLabel(m)}</div>
                        <div className="mt-0.5 truncate font-mono text-[10.5px] text-[var(--ink-muted)]">
                          {providerLabel(m)} · {m.modelId}
                        </div>
                      </div>
                      {m.contextWindow ? (
                        <span className="hidden shrink-0 rounded-full bg-[var(--hub-control)] px-2 py-1 font-mono text-[10px] tnum text-[var(--ink-muted)] sm:inline">
                          {formatContextWindow(m.contextWindow)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="shrink-0 border-t border-[var(--hub-border)] px-4 py-2.5 text-[11.5px] leading-5 text-[var(--ink-muted)] sm:px-5">
                勾选 {COMPARE_MIN_MODELS}-{COMPARE_MAX_MODELS} 个模型后开始对比；
                对比回答不携带图片附件，也不启用工具调用。
              </div>
            </div>
          ) : (
            <div className="agent-thumb-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              <div
                className={cn(
                  'grid grid-cols-1 gap-3',
                  columns.length >= 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2',
                )}
              >
                {columns.map((col) => (
                  <CompareColumnCard
                    key={col.key}
                    column={col}
                    now={now}
                    onAdopt={() => handleAdoptColumn(col)}
                  />
                ))}
              </div>
            </div>
          )}
        </motion.section>
      </div>
    </div>
  );
}

/**
 * CompareColumnCard —— 对比浮层的单列：模型名头部 + 独立流式内容
 * （MarkdownStreamPreview，完成后仍用它 —— 对比场景不必上重型渲染器）+
 * 状态（流式呼吸点 / 用时 / usage token / 错误红字）+「采纳这条」。
 */
function CompareColumnCard({
  column,
  now,
  onAdopt,
}: {
  column: CompareColumn;
  now: number;
  onAdopt: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isStreaming = column.status === 'streaming';

  // 流式期间跟随尾部（与 ThinkingPanel 同款写法）；完成后交还给用户滚动。
  useLayoutEffect(() => {
    if (!isStreaming) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isStreaming, column.content, column.think]);

  const endTs = isStreaming ? now : (column.finishedAt ?? column.startedAt);
  const elapsedSec = Math.max(0, endTs - column.startedAt) / 1000;
  const usage = column.usage;
  const canAdopt = column.status === 'done' && !column.error && column.content.trim() !== '';

  return (
    <div
      className={cn(
        'flex min-h-[16rem] flex-col overflow-hidden rounded-2xl border bg-[var(--hub-control)]',
        isStreaming
          ? 'border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)]'
          : column.status === 'error'
            ? 'border-[color-mix(in_oklch,var(--signal-danger)_30%,transparent)]'
            : 'border-[var(--hub-border)]',
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--hub-border)] px-3 py-2">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklch,var(--aurora-1)_12%,transparent)] text-[var(--aurora-1)]"
          aria-hidden="true"
        >
          <Brain className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[12.5px] font-medium text-[var(--ink-primary)]"
            title={modelLabel(column.model)}
          >
            {modelLabel(column.model)}
          </div>
          <div className="truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            {providerLabel(column.model)}
          </div>
        </div>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tnum text-[var(--ink-muted)]">
          {isStreaming && <span className="hub-think-live-dot" aria-label="生成中" />}
          {column.status === 'error' ? (
            <span className="text-[var(--signal-danger)]">失败</span>
          ) : (
            <span className="whitespace-nowrap">
              {isStreaming ? '' : '用时 '}
              {elapsedSec.toFixed(1)}s
            </span>
          )}
          {usage && (
            <span className="whitespace-nowrap">
              · {usage.estimated ? '~' : ''}
              {formatTokenCount(usage.totalTokens)} tok
            </span>
          )}
        </span>
      </div>

      <div
        ref={scrollerRef}
        className="hub-think-scroll max-h-[46vh] min-h-0 flex-1 overflow-y-auto p-3 md:max-h-[52vh]"
      >
        {column.status === 'error' && !column.content ? (
          <div className="font-mono text-[11px] leading-relaxed tracking-[0.06em] text-[var(--signal-danger)]">
            ERROR · {column.error}
          </div>
        ) : !column.content ? (
          isStreaming ? (
            <div className="flex flex-col items-start gap-2 text-[11.5px] text-[var(--ink-muted)]">
              <TypingDots />
              {column.think && <span>思考中 · {column.think.length} 字符</span>}
            </div>
          ) : (
            <div className="text-[11.5px] text-[var(--ink-muted)]">（空回答）</div>
          )
        ) : (
          <>
            <MarkdownStreamPreview
              content={normalizeCjkInlineMarkdown(column.content)}
              className="hub-agent-md text-[13px] leading-relaxed"
            />
            {column.status === 'error' && (
              <div className="mt-2 font-mono text-[11px] tracking-[0.06em] text-[var(--signal-danger)]">
                ERROR · {column.error}
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--hub-border)] p-2">
        <button
          type="button"
          onClick={onAdopt}
          disabled={!canAdopt}
          className={cn(
            'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold transition-colors',
            canAdopt
              ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)] hover:bg-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]'
              : 'cursor-not-allowed bg-[color-mix(in_oklch,var(--ink-primary)_3%,transparent)] text-[var(--ink-muted)]',
          )}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          采纳这条
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Composer —— 输入框 + 发送 / 停止
// =============================================================================

function Composer({
  value,
  onChange,
  onSend,
  onAbort,
  streaming,
  activeSession,
  modelsState,
  onSetModel,
  sendShortcut,
  onSetSendShortcut,
  enableTools,
  onToggleEnableTools,
  selectedArticles,
  selectedTags,
  selectedKbs,
  selectedAtlasKps,
  autoKnowledge,
  onToggleAutoKnowledge,
  onPickArticle,
  onPickTag,
  onPickKb,
  onPickAtlasKp,
  onRemoveArticle,
  onRemoveTag,
  onRemoveKb,
  onRemoveAtlasKp,
  onSlashCommand,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onToggleContextBreak,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  activeSession: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  onSetModel: (modelId: string | null, providerCode: string | null) => void;
  sendShortcut: SendShortcut;
  onSetSendShortcut: (shortcut: SendShortcut) => void;
  enableTools: boolean;
  onToggleEnableTools: () => void;
  selectedArticles: AgentArticle[];
  selectedTags: AgentTag[];
  selectedKbs: AgentKnowledgeBase[];
  selectedAtlasKps: AtlasKnowledgePoint[];
  autoKnowledge: boolean;
  onToggleAutoKnowledge: () => void;
  onPickArticle: (article: AgentArticle) => void;
  onPickTag: (tag: AgentTag) => void;
  onPickKb: (kb: AgentKnowledgeBase) => void;
  onPickAtlasKp: (kp: AtlasKnowledgePoint) => void;
  onRemoveArticle: (id: number) => void;
  onRemoveTag: (slug: string) => void;
  onRemoveKb: (id: number) => void;
  onRemoveAtlasKp: (id: number) => void;
  onSlashCommand: (cmd: SlashCommand) => void;
  attachments: AgentAttachment[];
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onToggleContextBreak: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chipTrayRef = useRef<HTMLDivElement | null>(null);
  const atBtnRef = useRef<HTMLButtonElement | null>(null);
  const hashBtnRef = useRef<HTMLButtonElement | null>(null);
  const kbBtnRef = useRef<HTMLButtonElement | null>(null);
  const atlasBtnRef = useRef<HTMLButtonElement | null>(null);
  const slashBtnRef = useRef<HTMLButtonElement | null>(null);
  const sendMenuRef = useRef<HTMLDivElement | null>(null);
  const sendMenuCloseTimerRef = useRef<number | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  // 尊重系统「减少动态效果」：附件托盘展开与外框 layout 位移都降级为瞬时。
  const reduceMotion = useReducedMotion();
  const [picker, setPicker] = useState<'article' | 'tag' | 'kb' | 'atlas' | 'slash' | null>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 图片按钮按当前模型的 vision 能力门控 —— 自动路由或非视觉模型都禁用并给提示。
  const currentModel = useMemo(
    () => currentModelFromSession(activeSession, modelsState),
    [activeSession, modelsState],
  );
  const visionReady = !!currentModel?.abilities?.vision;
  // 工具按钮按当前模型的 functionCall 能力门控 —— 自动路由或不支持的模型禁用并提示。
  const functionCallReady = currentModel?.abilities?.functionCall === true;

  // 上下文用量计：断点之后的历史 + 草稿 + 附件的估算 token，进度按后端字符
  // 预算（28K，含安全余量）折算 —— 满则提示会自动省略较早消息。
  const contextStats = useMemo(() => {
    const history = activeSession
      ? sliceContextMessages(activeSession.messages, activeSession.contextBreakId)
      : [];
    const chars =
      history.reduce((sum, m) => sum + m.content.length, 0) + value.length;
    const tokens =
      estimateMessagesTokens([...history.map((m) => m.content), value]) +
      attachments.reduce((sum, a) => sum + attachmentTokenEstimate(a), 0);
    return { chars, tokens, percent: Math.min(999, Math.round((chars / CONTEXT_CHAR_BUDGET) * 100)) };
  }, [activeSession, value, attachments]);
  const hasContextBreak = !!activeSession?.contextBreakId;

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  useEffect(() => {
    autosize();
  }, [autosize, value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (isMobile) return;
    const shouldSend =
      sendShortcut === 'enter'
        ? !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
        : (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;

    if (shouldSend) {
      e.preventDefault();
      if (canSend) onSend(value);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const togglePicker = (k: 'article' | 'tag' | 'kb' | 'atlas' | 'slash') => {
    setPicker((cur) => (cur === k ? null : k));
  };

  const selectedArticleCount = selectedArticles.length;
  const selectedTagCount = selectedTags.length;
  const selectedKbCount = selectedKbs.length;
  const selectedAtlasCount = selectedAtlasKps.length;
  // 知识范围三态（与 selectAetherHubKnowledgeContext 的判定同源）：选了来源 =
  // 指定；没选 + 开关开 = 自动；没选 + 开关关 = 不检索。
  const knowledgeScopeLabel =
    selectedKbCount > 0 || selectedAtlasCount > 0
      ? '知识库 · 指定来源'
      : autoKnowledge
        ? '知识库 · 自动检索'
        : '知识库 · 本轮不检索';
  const selectedContextCount = selectedArticleCount + selectedTagCount + selectedKbCount + selectedAtlasCount;
  const selectedContextVisible = selectedContextCount > 0;
  const compactSelectedContext = picker !== null && selectedContextCount > 1;
  const trayScrollEnabled = selectedContextCount > 6;
  // 模型清单正在后台重拉时，items 还是旧的 —— 里面可能留着用户刚在 /ai-config
  // 停用的那个模型。此刻发送会拿旧清单解析出已失效的模型直送后端，换来一句
  // 「Requested model not found」；对账要等这次重拉落地才跑得了。窗口通常只有
  // 一个来回，但恰好落在「配完模型点浮岛回来立刻发」这条主路径上。
  // 只在会话真的钉了模型时才拦：自动路由不依赖清单，没有失效可言。
  const awaitingModelRevalidation =
    isModelCatalogRevalidating(modelsState) && !!activeSession?.modelId;
  const canSend = !!value.trim() && !streaming && !awaitingModelRevalidation;

  const clearSendMenuCloseTimer = useCallback(() => {
    if (sendMenuCloseTimerRef.current === null) return;
    window.clearTimeout(sendMenuCloseTimerRef.current);
    sendMenuCloseTimerRef.current = null;
  }, []);

  const openSendMenu = useCallback(() => {
    clearSendMenuCloseTimer();
    setSendMenuOpen(true);
  }, [clearSendMenuCloseTimer]);

  const closeSendMenu = useCallback(() => {
    clearSendMenuCloseTimer();
    setSendMenuOpen(false);
  }, [clearSendMenuCloseTimer]);

  const scheduleCloseSendMenu = useCallback(() => {
    clearSendMenuCloseTimer();
    sendMenuCloseTimerRef.current = window.setTimeout(() => {
      setSendMenuOpen(false);
      sendMenuCloseTimerRef.current = null;
    }, 160);
  }, [clearSendMenuCloseTimer]);

  useEffect(() => clearSendMenuCloseTimer, [clearSendMenuCloseTimer]);

  useEffect(() => {
    if (isMobile) closeSendMenu();
  }, [closeSendMenu, isMobile]);

  useEffect(() => {
    if (!sendMenuOpen || isMobile) return;
    const onDown = (e: MouseEvent) => {
      if (!sendMenuRef.current) return;
      if (!sendMenuRef.current.contains(e.target as Node)) closeSendMenu();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      // 输入法组合态放行（发送菜单就悬在输入框上方，用户多半正在打字）。
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') closeSendMenu();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [closeSendMenu, isMobile, sendMenuOpen]);

  useEffect(() => {
    const el = chipTrayRef.current;
    if (!el || !selectedContextVisible || !trayScrollEnabled) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollToBottom = (behavior: ScrollBehavior) => {
      el.scrollTo({ top: el.scrollHeight, behavior });
    };
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(reduceMotion ? 'auto' : 'smooth');
    });
    const settle = window.setTimeout(() => {
      scrollToBottom('auto');
    }, 280);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [selectedContextCount, selectedContextVisible, trayScrollEnabled]);

  return (
    <div className="shrink-0 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-1 md:px-8 md:pb-4 md:pt-3">
      <div className="relative mx-auto w-full max-w-[820px]">
        <motion.div
          layout
          transition={{ layout: { duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] } }}
          className={cn(
            'rounded-[1.75rem] bg-[var(--hub-panel-strong)] p-2.5 transition-[box-shadow,border-color] duration-300 md:rounded-3xl md:p-4',
            'border',
            focused
              ? 'border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)] shadow-[0_10px_32px_-12px_color-mix(in_oklch,var(--aurora-1)_38%,transparent),0_0_0_4px_color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
              : 'border-[var(--hub-border)] shadow-[0_14px_44px_-30px_rgba(0,0,0,0.45)] md:shadow-[0_4px_18px_-12px_rgba(0,0,0,0.25)]',
          )}
        >
          <ArticlePicker
            open={picker === 'article'}
            anchorRef={atBtnRef}
            selectedIds={new Set(selectedArticles.map((a) => a.id))}
            onClose={() => setPicker(null)}
            onPick={(a) => onPickArticle(a)}
          />
          <KnowledgeBasePicker
            open={picker === 'kb'}
            anchorRef={kbBtnRef}
            selectedIds={new Set(selectedKbs.map((kb) => kb.id))}
            hasExplicitSources={selectedKbCount > 0 || selectedAtlasCount > 0}
            autoKnowledge={autoKnowledge}
            onToggleAutoKnowledge={onToggleAutoKnowledge}
            onClose={() => setPicker(null)}
            onPick={(kb) => onPickKb(kb)}
          />
          <AtlasKPPicker
            open={picker === 'atlas'}
            anchorRef={atlasBtnRef}
            selectedIds={new Set(selectedAtlasKps.map((kp) => kp.id))}
            onClose={() => setPicker(null)}
            onPick={(kp) => onPickAtlasKp(kp)}
          />
          <TagPicker
            open={picker === 'tag'}
            anchorRef={hashBtnRef}
            selectedSlugs={new Set(selectedTags.map((t) => t.slug))}
            onClose={() => setPicker(null)}
            onPick={(tag) => onPickTag(tag)}
          />
          <SlashPicker
            open={picker === 'slash'}
            anchorRef={slashBtnRef}
            onClose={() => setPicker(null)}
            onPick={(cmd) => {
              setPicker(null);
              onSlashCommand(cmd);
            }}
          />

          <AnimatePresence initial={false}>
            {selectedContextVisible && (
              <motion.div
                key="selected-context-rail"
                layout
                initial={{ opacity: 0, y: 5, filter: 'blur(2px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -3, filter: 'blur(2px)' }}
                transition={{
                  layout: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                  opacity: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
                  y: { type: 'spring', stiffness: 440, damping: 36, mass: 0.7 },
                  filter: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
                }}
                className={cn('pb-1', picker && 'mb-1')}
              >
                <motion.div
                  ref={chipTrayRef}
                  layout
                  className={cn(
                    'agent-thumb-scroll flex gap-1.5 px-1 pb-1 pt-0.5',
                    picker
                      ? 'max-h-[76px] flex-wrap overflow-y-auto overscroll-contain'
                      : 'overflow-x-auto overscroll-x-contain sm:flex-wrap sm:overflow-visible',
                    !picker && trayScrollEnabled && 'sm:max-h-[76px] sm:overflow-y-auto sm:overscroll-contain',
                  )}
                  aria-label="已选择上下文"
                  style={{
                    scrollbarGutter: 'stable',
                  }}
                >
                  <AnimatePresence initial={false}>
                    {selectedKbs.map((kb) => (
                      <motion.span
                        key={`kb-${kb.id}`}
                        layout
                        initial={{ opacity: 0, scale: 0.98, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -3 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.72 }}
                        className={cn(
                          'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] pl-2.5 pr-1 text-[12px] text-[var(--ink-secondary)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_7%,transparent)]',
                          compactSelectedContext
                            ? 'max-w-[calc(50%_-_0.1875rem)] flex-[0_1_auto]'
                            : picker
                              ? 'max-w-[min(16rem,calc(100%-0.25rem))] flex-[0_1_auto]'
                              : 'max-w-[min(16rem,64vw)] shrink-0',
                        )}
                      >
                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-3)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate" title={kb.name}>
                          {kb.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveKb(kb.id)}
                          className="inline-flex !h-6 !w-6 !min-h-0 !min-w-0 shrink-0 items-center justify-center rounded-full p-0 text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                          aria-label={`移除知识库 ${kb.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.span>
                    ))}
                    {selectedAtlasKps.map((kp) => (
                      <motion.span
                        key={`atlas-${kp.id}`}
                        layout
                        initial={{ opacity: 0, scale: 0.98, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -3 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.72 }}
                        className={cn(
                          'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] pl-2.5 pr-1 text-[12px] text-[var(--ink-secondary)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_7%,transparent)]',
                          compactSelectedContext
                            ? 'max-w-[calc(50%_-_0.1875rem)] flex-[0_1_auto]'
                            : picker
                              ? 'max-w-[min(17rem,calc(100%-0.25rem))] flex-[0_1_auto]'
                              : 'max-w-[min(17rem,72vw)] shrink-0',
                        )}
                      >
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-2)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate" title={kp.title}>
                          {kp.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveAtlasKp(kp.id)}
                          className="inline-flex !h-6 !w-6 !min-h-0 !min-w-0 shrink-0 items-center justify-center rounded-full p-0 text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                          aria-label={`移除 Atlas KP ${kp.title}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.span>
                    ))}
                    {selectedArticles.map((a) => (
                      <motion.span
                        key={`art-${a.id}`}
                        layout
                        initial={{ opacity: 0, scale: 0.98, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -3 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.72 }}
                        className={cn(
                          'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] pl-2.5 pr-1 text-[12px] text-[var(--ink-secondary)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_7%,transparent)]',
                          compactSelectedContext
                            ? 'max-w-[calc(50%_-_0.1875rem)] flex-[0_1_auto]'
                            : picker
                              ? 'max-w-[min(17rem,calc(100%-0.25rem))] flex-[0_1_auto]'
                              : 'max-w-[min(17rem,72vw)] shrink-0',
                        )}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-1)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate" title={a.title}>
                          {a.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveArticle(a.id)}
                          className="inline-flex !h-6 !w-6 !min-h-0 !min-w-0 shrink-0 items-center justify-center rounded-full p-0 text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                          aria-label={`移除引用 ${a.title}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.span>
                    ))}
                    {selectedTags.map((tag) => (
                      <motion.span
                        key={`tag-${tag.slug}`}
                        layout
                        initial={{ opacity: 0, scale: 0.98, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -3 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 36, mass: 0.72 }}
                        className={cn(
                          'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] pl-2.5 pr-1 text-[12px] text-[var(--ink-secondary)] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_7%,transparent)]',
                          compactSelectedContext
                            ? 'max-w-[calc(50%_-_0.1875rem)] flex-[0_1_auto]'
                            : picker
                              ? 'max-w-[min(14rem,calc(100%-0.25rem))] flex-[0_1_auto]'
                              : 'max-w-[min(14rem,58vw)] shrink-0',
                        )}
                      >
                        <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--aurora-2)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate" title={tag.name}>
                          {tag.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveTag(tag.slug)}
                          className="inline-flex !h-6 !w-6 !min-h-0 !min-w-0 shrink-0 items-center justify-center rounded-full p-0 text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                          aria-label={`移除标签 ${tag.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.span>
                    ))}
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 待发送图片托盘 */}
          <AnimatePresence initial={false}>
            {attachments.length > 0 && (
              <motion.div
                key="attachment-tray"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-2 px-1 pb-2 pt-0.5" aria-label="待发送图片">
                  {attachments.map((a) => (
                    <span key={a.id} className="group/att relative">
                      <img
                        src={a.dataUrl}
                        alt={a.name}
                        className="h-16 w-16 rounded-xl border border-[var(--hub-border)] object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(a.id)}
                        aria-label={`移除图片 ${a.name}`}
                        title="移除图片"
                        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] text-[var(--ink-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--signal-danger)] focus-visible:opacity-100 group-hover/att:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
                f.type.startsWith('image/'),
              );
              if (files.length > 0) {
                e.preventDefault();
                onAddAttachments(files);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
                f.type.startsWith('image/'),
              );
              if (files.length > 0) {
                e.preventDefault();
                onAddAttachments(files);
              }
            }}
            rows={1}
            placeholder={
              streaming
                ? '正在生成回答 —— 可以先起草下一条问题'
                : '问灵境，知识库 · Atlas · @ 文章 · # 标签 · / 命令'
            }
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'block max-h-[132px] w-full resize-none bg-transparent px-1.5 text-[15px] leading-[1.5] text-[var(--ink-primary)] md:max-h-[240px] md:px-1',
              picker ? 'py-1.5' : 'py-2',
              'placeholder:text-[var(--ink-muted)] placeholder:opacity-70',
              'border-0 outline-none focus:border-0 focus:outline-none focus:ring-0',
              'md:text-[var(--fs-body)]',
            )}
            style={{ boxShadow: 'none' }}
          />
          <div className="mt-1.5 grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-[var(--hub-border)]/80 pt-2 md:mt-2 md:min-h-10">
            <div className="agent-thumb-scroll flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain pr-1 sm:overflow-visible sm:pr-0">
              {/* 流式期间也可换模型 —— 只影响下一轮请求，当前流由闭包 pin 住不受影响。 */}
              <ModelPickerButton
                activeSession={activeSession}
                modelsState={modelsState}
                disabled={false}
                onSetModel={onSetModel}
                placement="top"
                align="start"
              />
              <span
                aria-hidden="true"
                className="mx-1 hidden h-4 w-px bg-[var(--hub-border)] sm:inline-block"
              />
              <ToolButton
                ref={kbBtnRef}
                title={knowledgeScopeLabel}
                active={picker === 'kb'}
                count={selectedKbCount}
                dot={autoKnowledge && selectedKbCount === 0}
                onClick={() => togglePicker('kb')}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolButton
                ref={atlasBtnRef}
                title="选择 Atlas KP"
                active={picker === 'atlas'}
                count={selectedAtlasCount}
                onClick={() => togglePicker('atlas')}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolButton
                ref={atBtnRef}
                title="引用文章 (@)"
                active={picker === 'article'}
                count={selectedArticleCount}
                onClick={() => togglePicker('article')}
              >
                <AtSign className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolButton
                ref={hashBtnRef}
                title="圈定标签 (#)"
                active={picker === 'tag'}
                count={selectedTagCount}
                onClick={() => togglePicker('tag')}
              >
                <Hash className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolButton
                ref={slashBtnRef}
                title="斜杠命令 (/)"
                active={picker === 'slash'}
                onClick={() => togglePicker('slash')}
              >
                <SlashSquare className="h-3.5 w-3.5" />
              </ToolButton>
              <span
                aria-hidden="true"
                className="mx-1 hidden h-4 w-px bg-[var(--hub-border)] sm:inline-block"
              />
              <ToolButton
                title={
                  visionReady
                    ? '发送图片（也可直接粘贴 / 拖入）'
                    : '当前模型不支持图片输入 —— 请先选择带「视觉」能力的模型'
                }
                count={attachments.length}
                disabled={!visionReady}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </ToolButton>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  onAddAttachments(files);
                }}
              />
              <ToolButton
                title={
                  !functionCallReady
                    ? '当前模型不支持函数调用 —— 请先选择带「函数调用」能力的模型'
                    : enableTools
                      ? '工具调用已开启 —— 模型可检索站内文章与知识库'
                      : '开启工具调用（检索站内文章 / 知识库）'
                }
                active={enableTools && functionCallReady}
                disabled={!functionCallReady}
                onClick={onToggleEnableTools}
              >
                <Wrench className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolButton
                title={
                  hasContextBreak
                    ? '已设置上下文断点 —— 再点一次或点分隔线恢复'
                    : '清除上下文（消息保留，模型从此处重新开始记忆）'
                }
                active={hasContextBreak}
                disabled={!activeSession || activeSession.messages.length === 0}
                onClick={onToggleContextBreak}
              >
                <Scissors className="h-3.5 w-3.5" />
              </ToolButton>
              {(activeSession?.messages.length ?? 0) > 0 && (
                <span
                  className={cn(
                    'ml-auto hidden shrink-0 items-center gap-1 pl-2 font-mono text-[10px] tnum sm:inline-flex',
                    contextStats.percent >= 100
                      ? 'text-[var(--signal-warn)]'
                      : 'text-[var(--ink-muted)]',
                  )}
                  title={
                    contextStats.percent >= 100
                      ? '上下文已满：发送时会自动省略最早的消息（可用剪刀清除上下文）'
                      : '当前上下文占用（估算）'
                  }
                >
                  ~{formatTokenCount(contextStats.tokens)} tok · {contextStats.percent}%
                </span>
              )}
            </div>

            {streaming ? (
              <button
                type="button"
                onClick={onAbort}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--signal-danger)_28%,transparent)] bg-[color-mix(in_oklch,var(--signal-danger)_18%,transparent)] px-3 text-[12px] font-medium text-[var(--signal-danger)] transition-colors hover:bg-[color-mix(in_oklch,var(--signal-danger)_24%,transparent)] active:scale-95 md:h-11"
                aria-label="停止生成"
                title="停止生成"
              >
                <Square className="h-3 w-3 fill-current" />
                停止
              </button>
            ) : isMobile ? (
              <button
                type="button"
                onClick={() => onSend(value)}
                disabled={!canSend}
                className={cn(
                  'grid h-11 w-12 shrink-0 place-items-center rounded-[1.35rem] border transition-[border-color,background-color,color] duration-200 active:scale-95',
                  canSend
                    ? 'border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--bg-void)]'
                    : 'cursor-not-allowed border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-muted)]',
                )}
                aria-label="发送"
                title={awaitingModelRevalidation ? '正在核对模型清单…' : '发送'}
              >
                <Send className="h-[18px] w-[18px] -rotate-12 fill-current stroke-[2.4]" />
              </button>
            ) : (
              <div
                ref={sendMenuRef}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') openSendMenu();
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse') scheduleCloseSendMenu();
                }}
                onFocusCapture={openSendMenu}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    closeSendMenu();
                  }
                }}
                className={cn(
                  'relative flex h-11 shrink-0 items-center overflow-visible rounded-[1.35rem] border transition-[border-color,background-color,color] duration-200',
                  canSend
                    ? 'border-[var(--ink-primary)] bg-[var(--ink-primary)] text-[var(--bg-void)]'
                    : 'border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-muted)]',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSend(value)}
                  disabled={!canSend}
                  className={cn(
                    'grid h-11 w-12 place-items-center rounded-l-[1.35rem] transition-colors active:scale-95',
                    canSend
                      ? 'text-[var(--bg-void)] hover:bg-[color-mix(in_oklch,var(--bg-void)_9%,transparent)]'
                      : 'cursor-not-allowed text-[var(--ink-muted)]',
                  )}
                  aria-label="发送"
                  title={awaitingModelRevalidation ? '正在核对模型清单…' : '发送'}
                >
                  <Send className="h-[18px] w-[18px] -rotate-12 fill-current stroke-[2.4]" />
                </button>
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-7 w-px transition-colors',
                    canSend
                      ? 'bg-[color-mix(in_oklch,var(--bg-void)_24%,transparent)]'
                      : 'bg-[var(--hub-border)]',
                  )}
                />
                <button
                  type="button"
                  onClick={openSendMenu}
                  aria-expanded={sendMenuOpen}
                  aria-haspopup="menu"
                  aria-label="选择发送方式"
                  title="选择发送方式"
                  className={cn(
                    'grid h-11 w-10 place-items-center rounded-r-[1.35rem] transition-colors active:scale-95',
                    sendMenuOpen
                      ? canSend
                        ? 'bg-[color-mix(in_oklch,var(--bg-void)_12%,transparent)] text-[var(--bg-void)]'
                        : 'bg-[var(--hub-control-hover)] text-[var(--ink-primary)]'
                      : canSend
                        ? 'text-[var(--bg-void)] hover:bg-[color-mix(in_oklch,var(--bg-void)_9%,transparent)]'
                        : 'hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                  )}
                >
                  <ChevronDown
                    className={cn('h-[18px] w-[18px] transition-transform', sendMenuOpen && 'rotate-180')}
                  />
                </button>

                <AnimatePresence>
                  {sendMenuOpen && (
                    <motion.div
                      role="menu"
                      aria-label="发送触发方式"
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute bottom-full right-0 z-40 mb-3 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] p-2 backdrop-blur-2xl"
                    >
                      {SEND_SHORTCUT_OPTIONS.map((option) => {
                        const selected = option.value === sendShortcut;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            onClick={() => {
                              onSetSendShortcut(option.value);
                              setSendMenuOpen(false);
                            }}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                              selected
                                ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                                : 'text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)]',
                            )}
                          >
                            <span className="grid h-7 w-6 shrink-0 place-items-center text-[var(--ink-primary)]">
                              {selected && <Check className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                按
                                <span className="rounded-md bg-[var(--hub-control)] px-2 py-1 font-mono text-[11px] text-[var(--ink-secondary)]">
                                  {option.keys}
                                </span>
                                发送
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

        </motion.div>
      </div>
    </div>
  );
}

const ToolButton = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode;
    title: string;
    active?: boolean;
    count?: number;
    /** 无计数但功能已生效时的状态点（例：知识库未选来源、但自动检索已开）。 */
    dot?: boolean;
    disabled?: boolean;
    onClick?: () => void;
  }
>(function ToolButton({ children, title, active, count, dot, disabled, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex !h-9 !w-9 !min-h-0 !min-w-0 shrink-0 items-center justify-center rounded-full p-0 transition-all duration-200 before:absolute before:-inset-1 before:content-[""] active:scale-95',
        active
          ? 'bg-[var(--hub-control)] text-[var(--ink-primary)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_26%,transparent)]'
          : 'text-[var(--ink-muted)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--aurora-1)]',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--ink-muted)] active:scale-100',
      )}
    >
      {children}
      {!!count && count > 0 && (
        <span className="absolute -right-1 -top-1 grid !h-4 min-w-4 place-items-center rounded-full bg-[var(--ink-primary)] px-1 font-mono text-[9px] leading-4 text-[var(--bg-void)] ring-2 ring-[var(--hub-panel-strong)]">
          {count > 9 ? '9+' : count}
        </span>
      )}
      {!count && dot && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--aurora-3)] ring-2 ring-[var(--hub-panel-strong)]"
        />
      )}
    </button>
  );
});

const PICKER_MOBILE_DEFAULT_HEIGHT = 360;
const PICKER_MOBILE_MIN_HEIGHT = 260;
const PICKER_MOBILE_MAX_HEIGHT = 620;

function clampPickerMobileHeight(value: number) {
  if (typeof window === 'undefined') {
    return Math.max(PICKER_MOBILE_MIN_HEIGHT, Math.min(PICKER_MOBILE_MAX_HEIGHT, value));
  }
  const viewportMax = Math.max(300, window.innerHeight - 168);
  return Math.max(
    PICKER_MOBILE_MIN_HEIGHT,
    Math.min(Math.min(PICKER_MOBILE_MAX_HEIGHT, viewportMax), value),
  );
}

function useMobilePickerResize(open: boolean) {
  const [mobileHeight, setMobileHeight] = useState(PICKER_MOBILE_DEFAULT_HEIGHT);

  useEffect(() => {
    if (open) setMobileHeight(clampPickerMobileHeight(PICKER_MOBILE_DEFAULT_HEIGHT));
  }, [open]);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches) {
        return;
      }
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = mobileHeight;

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = startY - moveEvent.clientY;
        setMobileHeight(clampPickerMobileHeight(startHeight + delta));
      };

      const handleEnd = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleEnd);
        window.removeEventListener('pointercancel', handleEnd);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleEnd);
      window.addEventListener('pointercancel', handleEnd);
    },
    [mobileHeight],
  );

  return { mobileHeight, handleResizeStart };
}

function PickerResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label="拖动调整面板高度"
      title="拖动调整面板高度"
      onPointerDown={onPointerDown}
      className="group absolute left-1/2 top-1.5 z-10 flex !h-5 !w-16 !min-h-0 !min-w-0 -translate-x-1/2 touch-none cursor-row-resize items-center justify-center rounded-full p-0 text-[var(--ink-muted)] active:cursor-grabbing sm:hidden"
    >
      <span className="h-1 w-9 rounded-full bg-[var(--hub-border)] transition-colors group-active:bg-[var(--ink-muted)]" />
    </button>
  );
}

function PickerPanelHeader({
  title,
  description,
  query,
  onQueryChange,
  placeholder,
  inputRef,
}: {
  title: string;
  description: string;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (!searchOpen) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [inputRef, searchOpen]);

  const handleCloseSearch = () => {
    onQueryChange('');
    setSearchOpen(false);
  };

  return (
    <div className="shrink-0 border-b border-[var(--hub-border)] px-4 pb-2 pt-5 sm:p-3">
      <div className="flex h-9 items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--ink-primary)]">{title}</div>
          <div className={cn('mt-0.5 truncate text-[11px] text-[var(--ink-muted)]', searchOpen && 'hidden sm:block')}>
            {description}
          </div>
        </div>
        <div
          className={cn(
            'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
            searchOpen ? 'w-[min(9.25rem,36vw)]' : 'w-8',
          )}
        >
          {searchOpen ? (
            <div className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] pl-2.5 pr-1 text-[var(--ink-muted)] shadow-none transition-colors focus-within:border-[color-mix(in_oklch,var(--aurora-1)_34%,transparent)] focus-within:bg-[var(--hub-panel-strong)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--aurora-1)_14%,transparent)]">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  // 中文输入法按 Esc 取消候选词不应连搜索框一起收起。
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Escape') handleCloseSearch();
                }}
                aria-label={placeholder}
                placeholder=""
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--ink-primary)] shadow-none outline-none focus:border-0 focus:outline-none focus:ring-0"
              />
              <button
                type="button"
                onClick={handleCloseSearch}
                aria-label="收起搜索"
                title="收起搜索"
                className="grid !h-6 !w-6 !min-h-0 !min-w-0 shrink-0 place-items-center rounded-full p-0 text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={`搜索${title}`}
              title={`搜索${title}`}
              className="relative grid !h-8 !w-8 !min-h-0 !min-w-0 place-items-center rounded-full bg-[var(--hub-control)] p-0 text-[var(--ink-secondary)] transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PickerPopover —— 通用弹层
// =============================================================================

function PickerPopover({
  open,
  onClose,
  anchorRef,
  ariaLabel,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { mobileHeight, handleResizeStart } = useMobilePickerResize(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      // 各 picker 面板内都有搜索框：输入法组合态的 Esc 属于「取消候选词」，
      // 放行后交给输入法自己消费，别把面板连同筛选结果一起关掉。
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={wrapRef}
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel}
          style={
            {
              '--hub-picker-height': `${mobileHeight}px`,
            } as React.CSSProperties
          }
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          layout
          transition={{
            duration: 0.18,
            ease: [0.16, 1, 0.3, 1],
            layout: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
          }}
          className={cn(
            'relative z-40 mb-2 flex h-[min(var(--hub-picker-height),calc(100dvh-18rem))] min-h-[260px] flex-col overflow-hidden rounded-[1.45rem] border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] shadow-[0_22px_54px_-24px_rgba(0,0,0,0.48)] backdrop-blur-2xl',
            'sm:absolute sm:bottom-full sm:left-0 sm:right-auto sm:mb-3 sm:h-auto sm:min-h-0 sm:max-h-none sm:rounded-xl sm:shadow-[0_24px_48px_-16px_rgba(0,0,0,0.35)]',
            className,
          )}
        >
          <PickerResizeHandle onPointerDown={handleResizeStart} />
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// KnowledgeBasePicker —— 选知识库
// =============================================================================

function KnowledgeBasePicker({
  open,
  onClose,
  anchorRef,
  selectedIds,
  hasExplicitSources,
  autoKnowledge,
  onToggleAutoKnowledge,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  selectedIds: Set<number>;
  hasExplicitSources: boolean;
  autoKnowledge: boolean;
  onToggleAutoKnowledge: () => void;
  onPick: (kb: AgentKnowledgeBase) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AgentKnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const q = query.trim();
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setError(null);
        fetchAgentKnowledgeBases(q || undefined)
          .then((res) => {
            if (cancelled) return;
            setItems(res.data || []);
          })
          .catch((err) => {
            if (cancelled) return;
            setItems([]);
            setError(err instanceof Error ? err.message : '知识库加载失败');
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      q ? 180 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const showInitialLoading = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择知识库"
      className="w-full sm:w-[min(360px,calc(100vw-1.5rem))]"
    >
      <PickerPanelHeader
        title="知识库"
        description="选择本轮对话要召回的资源"
        query={query}
        onQueryChange={setQuery}
        placeholder="搜索知识库…"
        inputRef={inputRef}
      />
      {/* 知识范围开关 —— 不选来源时的默认是「不检索」，自动检索必须显式打开。
          选了来源就以来源为准（后端拒绝 auto 携带显式 id），此时只做状态说明。 */}
      <div className="border-b border-[var(--hub-border)] px-3 py-2.5">
        {hasExplicitSources ? (
          <p className="text-[11.5px] leading-4 text-[var(--ink-muted)]">
            已指定来源 · 本轮只检索下方勾选的资源
          </p>
        ) : (
          <div className="space-y-2">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium leading-4 text-[var(--ink-primary)]">
                未指定来源时
              </p>
              <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
                {autoKnowledge
                  ? '每轮自动检索你有权限的知识库与知识点'
                  : '直接回答，不做知识检索'}
              </p>
            </div>
            <HubSegmentedControl
              ariaLabel="未指定来源时的知识范围"
              value={autoKnowledge ? 'auto' : 'none'}
              options={[
                { value: 'none', label: '不检索', title: '直接回答，不召回任何知识' },
                { value: 'auto', label: '自动', title: '自动检索你有权限的知识库与知识点' },
              ]}
              onChange={(next) => {
                if ((next === 'auto') !== autoKnowledge) onToggleAutoKnowledge();
              }}
            />
          </div>
        )}
      </div>
      <div className="agent-thumb-scroll relative min-h-0 flex-1 overflow-y-auto py-1.5 sm:h-[300px] sm:max-h-none sm:flex-none sm:py-1">
        {showInitialLoading && (
          <div className="absolute inset-x-3 top-4 space-y-2" aria-label="知识库加载中">
            <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--hub-control-hover)]" />
            <div className="h-11 animate-pulse rounded-xl bg-[var(--hub-control)]" />
            <div className="h-11 animate-pulse rounded-xl bg-[var(--hub-control)]" />
          </div>
        )}
        {error && !loading && (
          <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
            {error}
          </div>
        )}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            暂无可用知识库
          </div>
        )}
        {items.length > 0 && (
          <div className={cn('transition-opacity duration-150', loading ? 'opacity-50' : 'opacity-100')}>
            {items.map((kb) => {
              const selected = selectedIds.has(kb.id);
              return (
                <button
                  key={kb.id}
                  type="button"
                  onClick={() => {
                    if (!selected) onPick(kb);
                  }}
                  aria-disabled={selected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors sm:rounded-none sm:py-2',
                    selected
                      ? 'cursor-default text-[var(--aurora-3)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                  )}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--hub-control)] text-[var(--aurora-3)]">
                    {kb.kind === 'SYSTEM_POSTS' ? (
                      <Brain className="h-3.5 w-3.5" />
                    ) : (
                      <BookOpen className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm sm:text-[13px]">{kb.name}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ink-muted)]">
                      {kb.kind === 'SYSTEM_POSTS' ? '系统库' : '自定义'} · {kb.fileCount} 文件 ·{' '}
                      {kb.chunkCount} 分块
                    </span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PickerPopover>
  );
}

// =============================================================================
// AtlasKPPicker —— 选 Atlas KP
// =============================================================================

function AtlasKPPicker({
  open,
  onClose,
  anchorRef,
  selectedIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  selectedIds: Set<number>;
  onPick: (kp: AtlasKnowledgePoint) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AtlasKnowledgePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const q = query.trim();
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setError(null);
        atlasService
          .listKnowledgePoints({ keyword: q || undefined, limit: 100, scope: 'mine' })
          .then((res) => {
            if (cancelled) return;
            setItems((res.data || []).filter((kp) => !kp.archived && kp.status !== 'archived'));
          })
          .catch((err) => {
            if (cancelled) return;
            setItems([]);
            setError(err instanceof Error ? err.message : 'Atlas KP 加载失败');
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      q ? 180 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const showInitialLoading = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择 Atlas KP"
      className="w-full sm:w-[min(380px,calc(100vw-1.5rem))]"
    >
      <PickerPanelHeader
        title="Atlas KP"
        description="选择本轮回答要引用的知识点"
        query={query}
        onQueryChange={setQuery}
        placeholder="搜索 KP…"
        inputRef={inputRef}
      />
      <div className="agent-thumb-scroll relative min-h-0 flex-1 overflow-y-auto py-1.5 sm:h-[300px] sm:max-h-none sm:flex-none sm:py-1">
        {showInitialLoading && (
          <div className="absolute inset-x-3 top-4 space-y-2" aria-label="Atlas KP 加载中">
            <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--hub-control-hover)]" />
            <div className="h-11 animate-pulse rounded-xl bg-[var(--hub-control)]" />
            <div className="h-11 animate-pulse rounded-xl bg-[var(--hub-control)]" />
          </div>
        )}
        {error && !loading && (
          <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
            {error}
          </div>
        )}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            暂无可用 KP
          </div>
        )}
        {items.length > 0 && (
          <div className={cn('transition-opacity duration-150', loading ? 'opacity-50' : 'opacity-100')}>
            {items.map((kp) => {
              const selected = selectedIds.has(kp.id);
              return (
                <button
                  key={kp.id}
                  type="button"
                  onClick={() => {
                    if (!selected) onPick(kp);
                  }}
                  aria-disabled={selected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors sm:rounded-none sm:py-2',
                    selected
                      ? 'cursor-default text-[var(--aurora-2)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                  )}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--hub-control)] text-[var(--aurora-2)]">
                    <GitBranch className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm sm:text-[13px]">{kp.title}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ink-muted)]">
                      {kp.type} · {kp.status} · conf {kp.confidence.toFixed(2)}
                    </span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PickerPopover>
  );
}

// =============================================================================
// ArticlePicker —— @ 选文章
// =============================================================================

function ArticlePicker({
  open,
  onClose,
  anchorRef,
  selectedIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  selectedIds: Set<number>;
  onPick: (article: AgentArticle) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, total, loading, error } = useArticleSearch(
    query,
    open,
    page,
    ARTICLE_PAGE_SIZE,
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPage(1);
  }, [open]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const isSearching = query.trim().length > 0;
  const totalPages = isSearching ? 1 : Math.max(1, Math.ceil(total / ARTICLE_PAGE_SIZE));
  const canPrev = !isSearching && page > 1 && !loading;
  const canNext = !isSearching && page < totalPages && !loading;

  const showInitialLoading = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="引用文章"
      className="w-full sm:w-[min(360px,calc(100vw-1.5rem))]"
    >
      <PickerPanelHeader
        title="引用文章"
        description="把文章加入当前上下文"
        query={query}
        onQueryChange={setQuery}
        placeholder="搜索文章…"
        inputRef={inputRef}
      />
      {/* 列表区域固定高度 —— 内容数量变化不影响 modal 整体尺寸。 */}
      <div className="agent-thumb-scroll relative min-h-0 flex-1 overflow-y-auto py-1.5 sm:h-[300px] sm:max-h-none sm:flex-none sm:py-1">
        {showInitialLoading && (
          <div className="absolute inset-x-3 top-4 space-y-2" aria-label="搜索中">
            <div className="h-3 w-20 animate-pulse rounded-full bg-[var(--hub-control-hover)]" />
            <div className="h-10 animate-pulse rounded-xl bg-[var(--hub-control)]" />
            <div className="h-10 animate-pulse rounded-xl bg-[var(--hub-control)]" />
          </div>
        )}
        {error && !loading && (
          <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
            {error}
          </div>
        )}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有找到匹配的文章
          </div>
        )}
        {items.length > 0 && (
          <div
            className={cn(
              'transition-opacity duration-150',
              loading ? 'opacity-50' : 'opacity-100',
            )}
          >
            {items.map((article) => {
              const selected = selectedIds.has(article.id);
              return (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => {
                    if (!selected) onPick(article);
                  }}
                  aria-disabled={selected}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors sm:rounded-none sm:py-2',
                    selected
                      ? 'cursor-default text-[var(--aurora-1)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                  )}
                >
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-[13px]">{article.title}</div>
                    {article.summary && (
                      <div className="mt-0.5 line-clamp-1 text-[11.5px] text-[var(--ink-muted)]">
                        {article.summary}
                      </div>
                    )}
                    {(article.category || article.publishedAt) && (
                      <div className="mt-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
                        {article.category && (
                          <span className="truncate">{article.category}</span>
                        )}
                        {article.category && article.publishedAt && (
                          <span aria-hidden="true">·</span>
                        )}
                        {article.publishedAt && <span>{article.publishedAt}</span>}
                      </div>
                    )}
                  </div>
                  {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* 分页 footer —— 始终渲染，禁用态用透明度区分。 */}
      <div className="flex items-center justify-between border-t border-[var(--hub-border)] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[var(--ink-muted)]">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={!canPrev}
          aria-label="上一页"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30 enabled:hover:bg-[var(--hub-control-hover)] enabled:hover:text-[var(--ink-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span>{isSearching ? '搜索结果' : `第 ${page} / ${totalPages} 页`}</span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={!canNext}
          aria-label="下一页"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-30 enabled:hover:bg-[var(--hub-control-hover)] enabled:hover:text-[var(--ink-primary)]"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </PickerPopover>
  );
}

// =============================================================================
// TagPicker —— # 选标签
// =============================================================================

function TagPicker({
  open,
  onClose,
  anchorRef,
  selectedSlugs,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  selectedSlugs: Set<string>;
  onPick: (tag: AgentTag) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, loading, error } = useAllTags(open);

  const visible = useMemo(() => {
    const filtered = filterTags(items, query);
    return [...filtered].sort((a, b) => b.postCount - a.postCount);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);

  const showInitialLoading = loading && items.length === 0;

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择标签"
      className="w-full sm:w-[min(320px,calc(100vw-1.5rem))]"
    >
      <PickerPanelHeader
        title="圈定标签"
        description="限定这次对话的内容范围"
        query={query}
        onQueryChange={setQuery}
        placeholder="搜索标签…"
        inputRef={inputRef}
      />
      <div className="agent-thumb-scroll relative min-h-0 flex-1 overflow-y-auto py-1.5 sm:max-h-[320px] sm:flex-none sm:py-1">
        {showInitialLoading && (
          <div className="space-y-2 px-3 py-3" aria-label="标签加载中">
            <div className="h-3 w-20 animate-pulse rounded-full bg-[var(--hub-control-hover)]" />
            <div className="h-8 animate-pulse rounded-xl bg-[var(--hub-control)]" />
            <div className="h-8 animate-pulse rounded-xl bg-[var(--hub-control)]" />
            <div className="h-8 animate-pulse rounded-xl bg-[var(--hub-control)]" />
          </div>
        )}
        {error && !loading && (
          <div className="px-3 py-3 text-[var(--fs-caption)] text-[var(--signal-danger)]">
            {error}
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有匹配的标签
          </div>
        )}
        {!error && visible.length > 0 && (
          <div className={cn('transition-opacity duration-150', loading ? 'opacity-50' : 'opacity-100')}>
            {visible.map((tag) => {
              const selected = selectedSlugs.has(tag.slug);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    if (!selected) onPick(tag);
                  }}
                  aria-disabled={selected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors sm:rounded-none sm:py-2',
                    selected
                      ? 'cursor-default text-[var(--aurora-2)]'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                  )}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--hub-control)] text-[var(--ink-muted)]">
                    <Hash className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm sm:text-[13px]">{tag.name}</span>
                  <span className="tnum shrink-0 rounded-full bg-[var(--hub-control)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    {tag.postCount}
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PickerPopover>
  );
}

// =============================================================================
// SlashPicker —— / 选命令
// =============================================================================

function SlashPicker({
  open,
  onClose,
  anchorRef,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (cmd: SlashCommand) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => filterSlashCommands(query), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);

  return (
    <PickerPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      ariaLabel="选择命令"
      className="w-full sm:w-[min(320px,calc(100vw-1.5rem))]"
    >
      <PickerPanelHeader
        title="调用命令"
        description="选择一个写作或构建动作"
        query={query}
        onQueryChange={setQuery}
        placeholder="搜索命令…"
        inputRef={inputRef}
      />
      <div className="agent-thumb-scroll min-h-0 flex-1 overflow-y-auto py-1.5 sm:max-h-[320px] sm:flex-none sm:py-1">
        {visible.length === 0 && (
          <div className="px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            没有匹配的命令
          </div>
        )}
        {visible.map((cmd) => (
          <button
            key={cmd.command}
            type="button"
            onClick={() => onPick(cmd)}
            className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] sm:rounded-none sm:py-2"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--hub-control)] text-[var(--ink-muted)]">
              <SlashSquare className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[13px] tracking-[-0.01em]">{cmd.command}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-muted)]">
                {cmd.description}
              </div>
            </div>
            <span className="mt-1 shrink-0 rounded-full bg-[var(--hub-control)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              {cmd.kind === 'local' ? '本地' : '模板'}
            </span>
          </button>
        ))}
      </div>
    </PickerPopover>
  );
}

// =============================================================================
// 右侧上下文面板 —— 当前会话元信息
// =============================================================================

function ContextPanel({
  session,
  modelsState,
  collapsed,
  selectedArticles,
  selectedTags,
  selectedKbs,
  selectedAtlasKps,
  displayMode,
  onSetDisplayMode,
  streamAnimation,
  onSetStreamAnimation,
  fontSize,
  onSetFontSize,
  onSetModelParam,
  onResetModelParams,
  onToggleCollapsed,
  onRemoveArticle,
  onRemoveTag,
  onRemoveKb,
  onRemoveAtlasKp,
}: {
  session: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  collapsed: boolean;
  selectedArticles: AgentArticle[];
  selectedTags: AgentTag[];
  selectedKbs: AgentKnowledgeBase[];
  selectedAtlasKps: AtlasKnowledgePoint[];
  displayMode: DisplayMode;
  onSetDisplayMode: (mode: DisplayMode) => void;
  streamAnimation: StreamAnimationMode;
  onSetStreamAnimation: (mode: StreamAnimationMode) => void;
  fontSize: number;
  onSetFontSize: (n: number) => void;
  onSetModelParam: (key: string, value: AgentModelParams[string] | undefined) => void;
  onResetModelParams: () => void;
  onToggleCollapsed: () => void;
  onRemoveArticle: (id: number) => void;
  onRemoveTag: (slug: string) => void;
  onRemoveKb: (id: number) => void;
  onRemoveAtlasKp: (id: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<CapabilityPanelTab>('space');
  const [preview, setPreview] = useState<SpacePreviewTarget | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const currentModel = useMemo(
    () => currentModelFromSession(session, modelsState),
    [session, modelsState],
  );
  const modelDisplay = useMemo(() => {
    if (!session?.modelId) return '自动路由';
    return currentModel ? modelLabel(currentModel) : session.modelId;
  }, [session?.modelId, currentModel]);
  const providerDisplay = currentModel?.providerName || session?.providerCode || '路由策略';
  const numericParams = useMemo(() => buildNumericModelParams(currentModel), [currentModel]);
  const extendParams = useMemo(() => modelExtendParams(currentModel), [currentModel]);
  const disabledParams = useMemo(() => Array.from(modelDisabledParams(currentModel)), [currentModel]);
  const abilities = currentModel?.abilities || {};
  const activeParamKeys = useMemo(() => {
    const keys = new Set<string>(numericParams.map((param) => param.key));
    if (extendParams.some((key) => REASONING_EXTEND_PARAM_KEYS.has(key))) keys.add('reasoning_effort');
    if (extendParams.includes('textVerbosity')) keys.add('verbosity');
    if (extendParams.includes('thinkingBudget')) keys.add('thinkingBudget');
    if (extendParams.some((key) => key.startsWith('thinkingLevel'))) keys.add('thinkingLevel');
    if (extendParams.includes('enableReasoning')) keys.add('enableReasoning');
    if (extendParams.includes('disableContextCaching')) keys.add('disableContextCaching');
    return Array.from(keys);
  }, [numericParams, extendParams]);
  const sessionParamCount = Object.keys(cleanModelParams(session?.modelParams) || {}).length;

  const spaceCount = selectedArticles.length + selectedTags.length + selectedKbs.length + selectedAtlasKps.length;
  const hasSpaceItems = spaceCount > 0;

  useEffect(() => {
    if (collapsed) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      // 面板内有资源搜索框；输入法组合态的 Esc 一律放行（同 SpacePreviewDialog：
      // 预览的关闭也走这条监听）。
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        if (preview) setPreview(null);
        else onToggleCollapsed();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [collapsed, onToggleCollapsed, preview]);

  useEffect(() => {
    if (collapsed || !isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [collapsed, isMobile]);

  const panelMotion = isMobile
    ? {
        initial: { y: '100%', opacity: 1, scale: 1 },
        animate: { y: 0, opacity: 1, scale: 1 },
        exit: { y: '100%', opacity: 1, scale: 1 },
      }
    : {
        initial: { x: 34, opacity: 0, scale: 0.985 },
        animate: { x: 0, opacity: 1, scale: 1 },
        exit: { x: 34, opacity: 0, scale: 0.985 },
      };
  const panelTransition = isMobile
    ? { type: 'spring' as const, stiffness: 360, damping: 34, mass: 0.9 }
    : { type: 'spring' as const, stiffness: 430, damping: 36, mass: 0.82 };

  return (
    <>
      <AnimatePresence>
        {!collapsed && (
          <div className="fixed inset-0 z-50 md:z-40">
            <motion.div
              className="absolute inset-0 bg-black/45 backdrop-blur-sm md:bg-black/10 md:backdrop-blur-[1px] xl:bg-transparent xl:backdrop-blur-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              onClick={onToggleCollapsed}
              aria-hidden="true"
            />
            <motion.aside
              role="dialog"
              aria-modal={isMobile}
              aria-label="空间与参数侧栏"
              initial={panelMotion.initial}
              animate={panelMotion.animate}
              exit={panelMotion.exit}
              transition={panelTransition}
              className="absolute inset-x-0 bottom-0 top-auto flex max-h-[66vh] w-full overflow-hidden rounded-t-[28px] border border-b-0 border-[var(--hub-border)] bg-[var(--hub-panel-strong)] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-28px_70px_-34px_rgba(0,0,0,0.64)] backdrop-blur-2xl md:bottom-4 md:left-auto md:right-4 md:top-[76px] md:max-h-none md:w-[min(440px,calc(100vw-1.25rem))] md:rounded-[28px] md:border-b md:pb-0 md:shadow-[0_28px_80px_-38px_rgba(0,0,0,0.55)]"
            >
              <div className="hidden w-[58px] shrink-0 flex-col items-center gap-2 border-r border-[var(--hub-border)] bg-[var(--hub-control)]/35 px-2 py-4 md:flex">
                <CapabilityRailButton
                  label="空间"
                  active={activeTab === 'space'}
                  onClick={() => setActiveTab('space')}
                >
                  <Layers3 className="h-5 w-5" />
                </CapabilityRailButton>
                <CapabilityRailButton
                  label="参数"
                  active={activeTab === 'params'}
                  onClick={() => setActiveTab('params')}
                >
                  <Settings className="h-5 w-5" />
                </CapabilityRailButton>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  aria-label="关闭侧栏"
                  title="关闭侧栏"
                  className="grid h-10 w-10 place-items-center rounded-2xl text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                >
                  <SidebarIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-[var(--hub-border)] px-4 pb-3 pt-3 md:flex md:h-[68px] md:items-center md:justify-between md:gap-3 md:px-5 md:py-0">
                  <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--hub-border)] md:hidden" />
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
                      <button
                        type="button"
                        onClick={() => setActiveTab('space')}
                        className={cn(
                          'h-11 min-w-0 flex-1 rounded-2xl px-4 text-[15px] font-semibold transition-colors md:h-10 md:flex-none',
                          activeTab === 'space'
                            ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                            : 'text-[var(--ink-muted)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                        )}
                      >
                        空间
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('params')}
                        className={cn(
                          'h-11 min-w-0 flex-1 rounded-2xl px-4 text-[15px] font-semibold transition-colors md:h-10 md:flex-none',
                          activeTab === 'params'
                            ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
                            : 'text-[var(--ink-muted)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                        )}
                      >
                        参数
                      </button>
                    </div>
                    <IconButton label="关闭侧栏" onClick={onToggleCollapsed} className="h-11 w-11 shrink-0 border-0 bg-transparent md:h-9 md:w-9">
                      {isMobile ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </IconButton>
                  </div>
                </div>

                <div className="agent-thumb-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 md:px-5 md:py-5">
                  <AnimatePresence mode="wait" initial={false}>
                    {activeTab === 'space' ? (
                      <motion.div
                        key="space"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="space-y-5"
                      >
                        <PanelBlock
                          title="最终空间"
                          description="这些资源会作为本轮对话的召回边界与参考材料。"
                        >
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5 sm:gap-2">
                            <SpaceMetric label="文章" value={selectedArticles.length} />
                            <SpaceMetric label="知识库" value={selectedKbs.length} />
                            <SpaceMetric label="Atlas" value={selectedAtlasKps.length} />
                            <SpaceMetric label="标签" value={selectedTags.length} />
                            <SpaceMetric label="文件" value={selectedKbs.reduce((sum, kb) => sum + kb.fileCount, 0)} />
                          </div>
                        </PanelBlock>

                        <PanelBlock title="资源列表">
                          {!hasSpaceItems && (
                            <div className="rounded-2xl border border-dashed border-[var(--hub-border)] px-4 py-8 text-center">
                              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-[var(--hub-control)] text-[var(--ink-muted)]">
                                <Layers3 className="h-5 w-5" />
                              </div>
                              <p className="text-sm font-medium text-[var(--ink-primary)]">
                                当前空间为空
                              </p>
                              <p className="mt-1 text-[12px] leading-snug text-[var(--ink-muted)]">
                                在输入框里选择文章、标签、知识库或 Atlas KP 后，这里会形成最终上下文空间。
                              </p>
                            </div>
                          )}

                          {hasSpaceItems && (
                            <div className="space-y-2.5">
                              {selectedArticles.map((article) => (
                                <SpaceResourceRow
                                  key={`space-article-${article.id}`}
                                  icon={<FileText className="h-4 w-4" />}
                                  tone="article"
                                  title={article.title}
                                  meta={[
                                    '文章',
                                    article.category,
                                    article.publishedAt,
                                  ].filter(Boolean).join(' · ')}
                                  description={article.summary || '点击查看这篇文章的上下文预览'}
                                  onOpen={() => setPreview({ kind: 'article', article })}
                                  onRemove={() => onRemoveArticle(article.id)}
                                />
                              ))}
                              {selectedKbs.map((kb) => (
                                <SpaceResourceRow
                                  key={`space-kb-${kb.id}`}
                                  icon={kb.kind === 'SYSTEM_POSTS' ? <Brain className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                                  tone="kb"
                                  title={kb.name}
                                  meta={`${kb.kind === 'SYSTEM_POSTS' ? '系统库' : '自定义'} · ${kb.fileCount} 文件 · ${kb.chunkCount} 分块`}
                                  description={kb.activeProfile?.name || '点击查看知识库召回配置与空间信息'}
                                  onOpen={() => setPreview({ kind: 'kb', kb })}
                                  onRemove={() => onRemoveKb(kb.id)}
                                />
                              ))}
                              {selectedAtlasKps.map((kp) => (
                                <SpaceResourceRow
                                  key={`space-atlas-${kp.id}`}
                                  icon={<GitBranch className="h-4 w-4" />}
                                  tone="tag"
                                  title={kp.title}
                                  meta={`Atlas KP · ${kp.type} · ${kp.status}`}
                                  description={kp.bodyMarkdown || '点击查看 Atlas KP 范围信息'}
                                  onOpen={() => setPreview({ kind: 'atlas', kp })}
                                  onRemove={() => onRemoveAtlasKp(kp.id)}
                                />
                              ))}
                              {selectedTags.map((tag) => (
                                <SpaceResourceRow
                                  key={`space-tag-${tag.slug}`}
                                  icon={<Hash className="h-4 w-4" />}
                                  tone="tag"
                                  title={tag.name}
                                  meta={`标签 · ${tag.postCount} 篇文章`}
                                  description={`会把对话范围限定到 #${tag.slug}`}
                                  onOpen={() => setPreview({ kind: 'tag', tag })}
                                  onRemove={() => onRemoveTag(tag.slug)}
                                />
                              ))}
                            </div>
                          )}
                        </PanelBlock>

                        <PanelBlock title="能力支撑">
                          <div className="grid gap-3">
                            <CapabilityLine label="模型" value={modelDisplay} />
                            <CapabilityLine label="空间范围" value={spaceCount > 0 ? `${spaceCount} 项资源` : '未限定'} />
                            <CapabilityControl
                              icon={displayMode === 'bubble' ? <MessageCircle className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                              label="显示"
                              value={displayMode === 'bubble' ? '气泡' : '版书'}
                            >
                              <HubSegmentedControl
                                ariaLabel="显示模式"
                                value={displayMode}
                                options={[
                                  { value: 'bubble', label: '气泡', title: '彩色卡片承载' },
                                  { value: 'engraved', label: '版书', title: '文字浮印纸面' },
                                ]}
                                onChange={(value) => onSetDisplayMode(value as DisplayMode)}
                              />
                            </CapabilityControl>
                            <CapabilityControl
                              icon={<RefreshCcw className="h-4 w-4" />}
                              label="流式动画"
                              value={streamAnimation === 'smooth' ? '平滑' : streamAnimation === 'fade' ? '淡入' : '无'}
                            >
                              <HubSegmentedControl
                                ariaLabel="流式动画"
                                value={streamAnimation}
                                options={[
                                  { value: 'none', label: '无' },
                                  { value: 'fade', label: '淡入' },
                                  { value: 'smooth', label: '平滑' },
                                ]}
                                onChange={(value) => onSetStreamAnimation(value as StreamAnimationMode)}
                              />
                            </CapabilityControl>
                            <CapabilityControl
                              icon={<FileText className="h-4 w-4" />}
                              label="字号"
                              value={`${fontSize}px`}
                            >
                              <div className="px-0.5">
                                <input
                                  type="range"
                                  min={12}
                                  max={18}
                                  step={0.5}
                                  value={fontSize}
                                  onChange={(e) => onSetFontSize(Number(e.target.value))}
                                  className="hub-range w-full"
                                  aria-label="消息字体大小"
                                  style={
                                    {
                                      '--hub-range-progress': `${(fontSize - 12) / (18 - 12)}`,
                                    } as React.CSSProperties
                                  }
                                />
                                <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                                  <span>A</span>
                                  <span>标准</span>
                                  <span>A</span>
                                </div>
                              </div>
                            </CapabilityControl>
                          </div>
                        </PanelBlock>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="params"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="space-y-5"
                      >
                        <PanelBlock
                          title="模型配置"
                          description="参数项来自 AI 模型配置中的 parameters 与 extendParams。"
                        >
                          <div className="rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[var(--ink-primary)]">
                                  {modelDisplay}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                                  <span className="rounded-full bg-[var(--hub-panel-strong)] px-2 py-0.5">
                                    {providerDisplay}
                                  </span>
                                  {currentModel?.scope && (
                                    <span className="rounded-full bg-[var(--hub-panel-strong)] px-2 py-0.5">
                                      {currentModel.scope === 'user' ? '用户凭证' : '系统凭证'}
                                    </span>
                                  )}
                                  {currentModel?.source && (
                                    <span className="rounded-full bg-[var(--hub-panel-strong)] px-2 py-0.5">
                                      {currentModel.source}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="shrink-0 rounded-full bg-[var(--hub-active)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--hub-accent-text)]">
                                {activeParamKeys.length} params
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <CapabilityLine
                                label="上下文"
                                value={formatContextWindow(currentModel?.contextWindow) || '—'}
                              />
                              <CapabilityLine
                                label="最大输出"
                                value={currentModel?.maxOutputTokens ? `${currentModel.maxOutputTokens}` : '—'}
                              />
                            </div>
                          </div>

                          {!currentModel && (
                            <div className="mt-3 rounded-2xl border border-dashed border-[var(--hub-border)] px-4 py-5 text-sm leading-6 text-[var(--ink-muted)]">
                              当前使用自动路由。选择具体模型后，这里会按该模型的可配置参数生成控件。
                            </div>
                          )}
                        </PanelBlock>

                        {currentModel && (
                          <>
                            <PanelBlock
                              title="采样参数"
                              description="只显示当前模型未禁用且可覆盖的通用生成参数。"
                            >
                              <div className="space-y-4">
                                {numericParams.map((param) => {
                                  const value = effectiveParamValue(session, param);
                                  return (
                                    <ModelParamSlider
                                      key={param.key}
                                      param={param}
                                      value={value}
                                      overridden={session?.modelParams?.[param.key] !== undefined}
                                      onChange={(next) => onSetModelParam(param.key, next)}
                                      onReset={() => onSetModelParam(param.key, undefined)}
                                    />
                                  );
                                })}
                              </div>
                            </PanelBlock>

                            <PanelBlock
                              title="扩展能力"
                              description="这些项由模型 settings.extendParams 决定，和模型商配置保持同源。"
                            >
                              {extendParams.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-[var(--hub-border)] px-4 py-5 text-sm text-[var(--ink-muted)]">
                                  当前模型没有声明扩展参数。
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {extendParams.some((key) => REASONING_EXTEND_PARAM_KEYS.has(key)) && (
                                    <ModelParamChoice
                                      label="推理强度"
                                      description="reasoning_effort"
                                      value={String(session?.modelParams?.reasoning_effort || 'medium')}
                                      options={REASONING_EFFORT_OPTIONS}
                                      onChange={(value) => onSetModelParam('reasoning_effort', value)}
                                      onReset={() => onSetModelParam('reasoning_effort', undefined)}
                                    />
                                  )}
                                  {extendParams.includes('textVerbosity') && (
                                    <ModelParamChoice
                                      label="输出详略"
                                      description="verbosity"
                                      value={String(session?.modelParams?.verbosity || 'medium')}
                                      options={TEXT_VERBOSITY_OPTIONS}
                                      onChange={(value) => onSetModelParam('verbosity', value)}
                                      onReset={() => onSetModelParam('verbosity', undefined)}
                                    />
                                  )}
                                  {extendParams.some((key) => key.startsWith('thinkingLevel')) && (
                                    <ModelParamChoice
                                      label="思考级别"
                                      description="thinkingLevel"
                                      value={String(session?.modelParams?.thinkingLevel || 'high')}
                                      options={THINKING_LEVEL_OPTIONS}
                                      onChange={(value) => onSetModelParam('thinkingLevel', value)}
                                      onReset={() => onSetModelParam('thinkingLevel', undefined)}
                                    />
                                  )}
                                  {extendParams.includes('thinkingBudget') && (
                                    <ModelParamSlider
                                      param={{
                                        key: 'max_tokens',
                                        label: '思考预算',
                                        description: 'thinkingBudget',
                                        min: 0,
                                        max: 32000,
                                        step: 512,
                                        defaultValue: 2048,
                                        tag: 'thinkingBudget',
                                        source: 'model',
                                      }}
                                      value={finiteNumber(session?.modelParams?.thinkingBudget) ?? 2048}
                                      overridden={session?.modelParams?.thinkingBudget !== undefined}
                                      onChange={(next) => onSetModelParam('thinkingBudget', next)}
                                      onReset={() => onSetModelParam('thinkingBudget', undefined)}
                                    />
                                  )}
                                  {extendParams.includes('enableReasoning') && (
                                    <ModelParamToggle
                                      label="深度思考"
                                      description="enableReasoning"
                                      checked={Boolean(session?.modelParams?.enableReasoning)}
                                      onChange={(next) => onSetModelParam('enableReasoning', next)}
                                      onReset={() => onSetModelParam('enableReasoning', undefined)}
                                    />
                                  )}
                                  {extendParams.includes('disableContextCaching') && (
                                    <ModelParamToggle
                                      label="禁用上下文缓存"
                                      description="disableContextCaching"
                                      checked={Boolean(session?.modelParams?.disableContextCaching)}
                                      onChange={(next) => onSetModelParam('disableContextCaching', next)}
                                      onReset={() => onSetModelParam('disableContextCaching', undefined)}
                                    />
                                  )}
                                </div>
                              )}
                            </PanelBlock>

                            <PanelBlock title="模型能力">
                              <div className="flex flex-wrap gap-2">
                                <ModelAbilityPill active={!!abilities.reasoning} label="推理" />
                                <ModelAbilityPill active={!!abilities.functionCall} label="函数调用" />
                                <ModelAbilityPill active={!!abilities.vision} label="视觉" />
                                <ModelAbilityPill active={!!abilities.search} label="搜索" />
                                <ModelAbilityPill active={!!abilities.files} label="文件" />
                                <ModelAbilityPill active={!!abilities.structuredOutput} label="结构化输出" />
                              </div>
                              {disabledParams.length > 0 && (
                                <div className="mt-3 rounded-2xl bg-[var(--hub-control)] px-3 py-2 text-[12px] leading-5 text-[var(--ink-muted)]">
                                  已按模型配置隐藏：{disabledParams.join('、')}
                                </div>
                              )}
                            </PanelBlock>

                            <PanelBlock title="本轮覆盖">
                              <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--hub-control)] px-3 py-3">
                                <div>
                                  <div className="text-sm font-medium text-[var(--ink-primary)]">
                                    已覆盖 {sessionParamCount} 个参数
                                  </div>
                                  <div className="mt-0.5 text-[11.5px] text-[var(--ink-muted)]">
                                    未覆盖的项继续使用模型配置或路由默认值
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={onResetModelParams}
                                  disabled={sessionParamCount === 0}
                                  className="h-9 rounded-xl border border-[var(--hub-border)] px-3 text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  重置
                                </button>
                              </div>
                            </PanelBlock>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
      <SpacePreviewDialog preview={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function CapabilityRailButton({
  children,
  label,
  active,
  onClick,
}: {
  children: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'grid h-10 w-10 place-items-center rounded-2xl transition-colors',
        active
          ? 'bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
          : 'text-[var(--ink-muted)] hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
      )}
    >
      {children}
    </button>
  );
}

function PanelBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--hub-border)] pb-5 last:border-b-0 last:pb-0">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--ink-primary)]">{title}</h3>
        {description && (
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--ink-muted)]">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function SpaceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] px-2 py-3 text-center">
      <div className="font-mono text-[16px] font-semibold tnum text-[var(--ink-primary)]">
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        {label}
      </div>
    </div>
  );
}

function SpaceResourceRow({
  icon,
  tone,
  title,
  meta,
  description,
  onOpen,
  onRemove,
}: {
  icon: ReactNode;
  tone: 'article' | 'kb' | 'tag';
  title: string;
  meta: string;
  description: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const toneClass =
    tone === 'article'
      ? 'text-[var(--aurora-1)]'
      : tone === 'kb'
        ? 'text-[var(--aurora-3)]'
        : 'text-[var(--aurora-2)]';

  return (
    <div className="group/resource flex items-stretch gap-2 rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-2 transition-colors hover:bg-[var(--hub-control-hover)]">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl text-left"
      >
        <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[var(--hub-panel-strong)]', toneClass)}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-[var(--ink-primary)]">
            {title}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            {meta}
          </span>
          <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-[var(--ink-muted)]">
            {description}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`移除 ${title}`}
        title="移除"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[var(--ink-muted)] opacity-70 transition-colors hover:bg-[var(--hub-panel-strong)] hover:text-[var(--ink-primary)] group-hover/resource:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CapabilityLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-[var(--hub-control)] px-3 py-2.5 text-sm">
      <span className="text-[var(--ink-muted)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[var(--ink-primary)]">{value}</span>
    </div>
  );
}

function CapabilityControl({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-[var(--hub-control)] p-2.5">
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-[var(--ink-muted)]">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-[var(--hub-panel-strong)] text-[var(--ink-secondary)]">
            {icon}
          </span>
          <span>{label}</span>
        </span>
        <span className="min-w-0 truncate text-right text-sm font-medium text-[var(--ink-primary)]">
          {value}
        </span>
      </div>
      {children}
    </div>
  );
}

function ModelParamSlider({
  param,
  value,
  overridden,
  onChange,
  onReset,
}: {
  param: NumericModelParam;
  value: number;
  overridden: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const progress = param.max === param.min ? 0 : (value - param.min) / (param.max - param.min);
  const decimals = String(param.step).includes('.') ? String(param.step).split('.')[1]?.length ?? 1 : 0;
  const displayValue = Number.isInteger(value) ? String(value) : value.toFixed(decimals);

  return (
    <div className="rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--ink-primary)]">{param.label}</span>
            <span className="rounded-full bg-[var(--hub-panel-strong)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
              {param.tag}
            </span>
            <span className="rounded-full bg-[var(--hub-panel-strong)] px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
              {param.source === 'model' ? '模型配置' : '通用默认'}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-[var(--ink-muted)]">
            {param.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={!overridden}
          className="h-8 shrink-0 rounded-xl border border-[var(--hub-border)] px-2.5 text-[12px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          默认
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_4.25rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4.75rem] sm:gap-3">
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="hub-range w-full"
          aria-label={param.label}
          style={
            {
              '--hub-range-progress': `${Math.min(1, Math.max(0, progress))}`,
            } as React.CSSProperties
          }
        />
        <input
          type="number"
          min={param.min}
          max={param.max}
          step={param.step}
          value={displayValue}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(param.max, Math.max(param.min, next)));
          }}
          className="h-9 min-w-0 w-full rounded-xl border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] px-2 text-right font-mono text-[12px] tnum text-[var(--ink-primary)] outline-none transition-colors focus:border-[color-mix(in_oklch,var(--aurora-1)_38%,transparent)]"
        />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">
        <span>{param.min}</span>
        <span>{overridden ? 'override' : 'default'}</span>
        <span>{param.max}</span>
      </div>
    </div>
  );
}

function ModelParamChoice({
  label,
  description,
  value,
  options,
  onChange,
  onReset,
}: {
  label: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--ink-primary)]">{label}</span>
            <span className="rounded-full bg-[var(--hub-panel-strong)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
              {description}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="h-8 shrink-0 rounded-xl border border-[var(--hub-border)] px-2.5 text-[12px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          默认
        </button>
      </div>
      <HubSegmentedControl
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

function ModelParamToggle({
  label,
  description,
  checked,
  onChange,
  onReset,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-control)] p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--ink-primary)]">{label}</span>
          <span className="rounded-full bg-[var(--hub-panel-strong)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
            {description}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="h-8 rounded-xl border border-[var(--hub-border)] px-2.5 text-[12px] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
        >
          默认
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative h-8 w-14 rounded-full border transition-colors',
            checked
              ? 'border-[color-mix(in_oklch,var(--aurora-1)_44%,transparent)] bg-[var(--hub-active)]'
              : 'border-[var(--hub-border)] bg-[var(--hub-panel-strong)]',
          )}
        >
          <span
            className={cn(
              'absolute top-1 h-6 w-6 rounded-full bg-[var(--ink-primary)] transition-transform',
              checked ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
      </div>
    </div>
  );
}

function ModelAbilityPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
        active
          ? 'border-[color-mix(in_oklch,var(--aurora-1)_28%,transparent)] bg-[var(--hub-active)] text-[var(--hub-accent-text)]'
          : 'border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-muted)]',
      )}
    >
      {label}
    </span>
  );
}

function SpacePreviewDialog({
  preview,
  onClose,
}: {
  preview: SpacePreviewTarget | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {preview && (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={onClose}
            aria-hidden="true"
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label="空间资源预览"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 430, damping: 34, mass: 0.8 }}
              className="flex max-h-[78vh] w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[26px] border border-[var(--hub-border)] bg-[var(--hub-panel-strong)] shadow-[0_30px_90px_-34px_rgba(0,0,0,0.62)] backdrop-blur-2xl"
            >
              <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--hub-border)] px-5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-[var(--ink-primary)]">
                    {preview.kind === 'article'
                      ? preview.article.title
                      : preview.kind === 'kb'
                        ? preview.kb.name
                        : preview.kind === 'atlas'
                          ? preview.kp.title
                          : preview.tag.name}
                  </h3>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                    {preview.kind === 'article'
                      ? 'Article'
                      : preview.kind === 'kb'
                        ? 'Knowledge Base'
                        : preview.kind === 'atlas'
                          ? 'Atlas KP'
                          : 'Tag'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭预览"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[var(--ink-muted)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="agent-thumb-scroll min-h-0 flex-1 overflow-y-auto p-5">
                {preview.kind === 'article' && (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-[var(--hub-control)] p-4">
                      <div className="mb-3 flex items-center gap-2 text-[var(--aurora-1)]">
                        <FileText className="h-4 w-4" />
                        <span className="text-sm font-medium text-[var(--ink-primary)]">引用文章</span>
                      </div>
                      <p className="text-sm leading-6 text-[var(--ink-secondary)]">
                        {preview.article.summary || '暂无摘要。发送时会按文章 ID 进入本轮上下文召回。'}
                      </p>
                    </div>
                    <MetadataRow label="文章 ID" value={preview.article.id} mono />
                    <MetadataRow label="分类" value={preview.article.category || '—'} />
                    <MetadataRow label="发布时间" value={preview.article.publishedAt || '—'} mono />
                  </div>
                )}

                {preview.kind === 'kb' && (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-[var(--hub-control)] p-4">
                      <div className="mb-3 flex items-center gap-2 text-[var(--aurora-3)]">
                        {preview.kb.kind === 'SYSTEM_POSTS' ? (
                          <Brain className="h-4 w-4" />
                        ) : (
                          <BookOpen className="h-4 w-4" />
                        )}
                        <span className="text-sm font-medium text-[var(--ink-primary)]">
                          {preview.kb.kind === 'SYSTEM_POSTS' ? '系统文章库' : '自定义知识库'}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-[var(--ink-secondary)]">
                        发送时会携带该知识库 ID，由后端按知识库权限与当前激活 Profile 召回相关片段。
                      </p>
                    </div>
                    <MetadataRow label="知识库 ID" value={preview.kb.id} mono />
                    <MetadataRow label="Slug" value={preview.kb.slug} mono />
                    <MetadataRow label="文件数" value={preview.kb.fileCount} mono />
                    <MetadataRow label="分块数" value={preview.kb.chunkCount} mono />
                    <MetadataRow label="Profile" value={preview.kb.activeProfile?.name || '默认'} />
                  </div>
                )}

                {preview.kind === 'atlas' && (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-[var(--hub-control)] p-4">
                      <div className="mb-3 flex items-center gap-2 text-[var(--aurora-2)]">
                        <GitBranch className="h-4 w-4" />
                        <span className="text-sm font-medium text-[var(--ink-primary)]">Atlas KP</span>
                      </div>
                      <p className="line-clamp-6 text-sm leading-6 text-[var(--ink-secondary)]">
                        {preview.kp.bodyMarkdown || '发送时会携带该 KP ID，由后端按 Atlas scope 注入 KP、邻接关系与 evidence。'}
                      </p>
                    </div>
                    <MetadataRow label="KP ID" value={preview.kp.id} mono />
                    <MetadataRow label="类型" value={preview.kp.type} />
                    <MetadataRow label="状态" value={preview.kp.status} />
                    <MetadataRow label="来源" value={preview.kp.provenance} />
                  </div>
                )}

                {preview.kind === 'tag' && (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-[var(--hub-control)] p-4">
                      <div className="mb-3 flex items-center gap-2 text-[var(--aurora-2)]">
                        <Hash className="h-4 w-4" />
                        <span className="text-sm font-medium text-[var(--ink-primary)]">标签范围</span>
                      </div>
                      <p className="text-sm leading-6 text-[var(--ink-secondary)]">
                        本轮对话会优先围绕该标签关联的文章集合进行筛选与召回。
                      </p>
                    </div>
                    <MetadataRow label="标签" value={preview.tag.name} />
                    <MetadataRow label="Slug" value={preview.tag.slug} mono />
                    <MetadataRow label="文章数" value={preview.tag.postCount} mono />
                  </div>
                )}
              </div>
            </motion.section>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}

function MobileContextSheet({
  open,
  session,
  modelsState,
  displayMode,
  onSetDisplayMode,
  streamAnimation,
  onSetStreamAnimation,
  fontSize,
  onSetFontSize,
  onClose,
  onDeleteSession,
  onClearMessages,
}: {
  open: boolean;
  session: AgentSession | null;
  modelsState: ReturnType<typeof useAgentModels>;
  displayMode: DisplayMode;
  onSetDisplayMode: (mode: DisplayMode) => void;
  streamAnimation: StreamAnimationMode;
  onSetStreamAnimation: (m: StreamAnimationMode) => void;
  fontSize: number;
  onSetFontSize: (n: number) => void;
  onClose: () => void;
  onDeleteSession: () => void;
  onClearMessages: () => void;
}) {
  const items = modelsState.status === 'ready' ? modelsState.items : [];
  const modelDisplay = useMemo(() => {
    if (!session?.modelId) return '自动路由';
    const found = items.find(
      (m) => m.modelId === session.modelId && m.providerCode === session.providerCode,
    );
    return found ? modelLabel(found) : session.modelId;
  }, [session?.modelId, session?.providerCode, items]);

  const messageCount = session?.messages.length ?? 0;
  const userMessageCount = session?.messages.filter((m) => m.role === 'user').length ?? 0;

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleCopyId = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.id);
      toast.success('对话 ID 已复制');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="当前对话配置"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }}
            className="absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col rounded-t-[28px] border border-b-0 border-[var(--hub-border)] bg-[var(--hub-panel)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-28px_70px_-32px_rgba(0,0,0,0.62)] backdrop-blur-2xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--hub-border)]" />
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-[var(--ink-primary)]">
                  当前对话配置
                </h2>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  {session?.title || '新对话'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭配置面板"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="agent-thumb-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <PanelCard>
                <h3 className="mb-4 text-sm font-medium text-[var(--ink-primary)]">对话信息</h3>
                <MetadataRow label="模型" value={modelDisplay} />
                <MetadataRow
                  label="消息数"
                  value={`${messageCount} / 用户 ${userMessageCount}`}
                  mono
                />
                <MetadataRow
                  label="最近活动"
                  value={session ? formatDate(new Date(session.updatedAt), 'yyyy-MM-dd HH:mm') : '—'}
                  mono
                />
                <button
                  type="button"
                  onClick={handleCopyId}
                  disabled={!session}
                  className={cn(
                    'mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-control)] text-sm text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
                    !session && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Copy className="h-4 w-4" />
                  复制对话 ID
                </button>
              </PanelCard>

              <PanelCard>
                <h3 className="mb-3 text-sm font-medium text-[var(--ink-primary)]">显示模式</h3>
                <HubSegmentedControl
                  ariaLabel="显示模式"
                  value={displayMode}
                  options={[
                    { value: 'bubble', label: '气泡', title: '彩色卡片承载' },
                    { value: 'engraved', label: '版书', title: '文字浮印纸面' },
                  ]}
                  onChange={(v) => onSetDisplayMode(v as DisplayMode)}
                />
              </PanelCard>

              <PanelCard>
                <h3 className="mb-3 text-sm font-medium text-[var(--ink-primary)]">过渡动画</h3>
                <SegmentedControl
                  value={streamAnimation}
                  options={[
                    { value: 'none', label: '无' },
                    { value: 'fade', label: '淡入' },
                    { value: 'smooth', label: '平滑' },
                  ]}
                  onChange={(v) => onSetStreamAnimation(v as StreamAnimationMode)}
                />
              </PanelCard>

              <PanelCard>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium text-[var(--ink-primary)]">字体大小</h3>
                  <span className="font-mono text-[11px] tnum text-[var(--ink-muted)]">
                    {fontSize}px
                  </span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={18}
                  step={0.5}
                  value={fontSize}
                  onChange={(e) => onSetFontSize(Number(e.target.value))}
                  className="hub-range w-full"
                  aria-label="字体大小"
                  style={
                    {
                      '--hub-range-progress': `${(fontSize - 12) / (18 - 12)}`,
                    } as React.CSSProperties
                  }
                />
                <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
                  <span>A</span>
                  <span>标准</span>
                  <span>A</span>
                </div>
              </PanelCard>

              <PanelCard>
                <h3 className="mb-4 text-sm font-medium text-[var(--ink-primary)]">快捷操作</h3>
                <div className="grid grid-cols-1 gap-3">
                  <ActionButton
                    icon={RefreshCcw}
                    onClick={onClearMessages}
                    disabled={!session || session.messages.length === 0}
                    className="rounded-xl"
                  >
                    清空当前对话
                  </ActionButton>
                  <ActionButton
                    icon={Trash2}
                    danger
                    onClick={() => {
                      onDeleteSession();
                      onClose();
                    }}
                    disabled={!session}
                    className="rounded-xl"
                  >
                    删除对话
                  </ActionButton>
                </div>
              </PanelCard>
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return <HubSegmentedControl ariaLabel="过渡动画" value={value} options={options} onChange={onChange} />;
}

function HubSegmentedControl({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string; title?: string }>;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const activeIndex = Math.max(0, options.findIndex((opt) => opt.value === value));

  // 视觉全部走 Codex token（--hub-* 派生自 ink/bg/aurora），亮暗主题靠
  // :root.light 翻转 —— 不写 dark: 变体，也不硬编码 hex/rgba 底色。
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="relative flex items-center rounded-[14px] border border-[var(--hub-border)] bg-[var(--hub-control)] p-[3px] shadow-[inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_6%,transparent)]"
    >
      <div
        className="absolute bottom-[3px] top-[3px] rounded-[11px] border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)] bg-[var(--hub-panel-strong)] shadow-[0_3px_10px_-4px_rgba(0,0,0,0.35),inset_0_1px_0_color-mix(in_oklch,var(--ink-primary)_8%,transparent)] transition-transform duration-quick ease-aether motion-reduce:transition-none"
        style={{
          left: 3,
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
          willChange: 'transform',
        }}
        aria-hidden="true"
      />

      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 flex h-10 flex-1 items-center justify-center whitespace-nowrap rounded-[11px] px-2.5 text-[13px] font-semibold tracking-normal transition-colors duration-quick ease-aether focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--aurora-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hub-panel-strong)]',
              active
                ? 'text-[var(--ink-primary)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function IconButton({
  children,
  label,
  className,
  onClick,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-control)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--hub-control-hover)] hover:text-[var(--ink-primary)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function PanelCard({ children }: { children: ReactNode }) {
  return <section className="surface-leaf !rounded-xl p-4">{children}</section>;
}

function MetadataRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 text-sm">
      <span className="text-[var(--ink-muted)]">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right text-[var(--ink-primary)]',
          mono && 'font-mono tnum',
        )}
      >
        {value}
      </span>
    </div>
  );
}

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ElementType;
  children: ReactNode;
  danger?: boolean;
};

function ActionButton({
  icon: Icon,
  children,
  danger,
  className,
  type,
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      {...rest}
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors',
        danger
          ? 'border-[color-mix(in_oklch,var(--signal-danger)_22%,transparent)] text-[var(--signal-danger)] hover:bg-[color-mix(in_oklch,var(--signal-danger)_10%,transparent)] disabled:opacity-50'
          : 'border-[var(--hub-border)] text-[var(--ink-primary)] hover:bg-[var(--hub-control-hover)] disabled:opacity-50',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

// =============================================================================
// 工具函数
// =============================================================================

function filterSessions(sessions: AgentSession[], query: string): AgentSession[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return sessions;

  // 全量消息检索（对齐 ChatGPT / LobeHub 的历史搜索）—— 早期版本只搜最后
  // 8 条，长对话的早期内容搜不到。纯内存 includes，几百条消息量级无压力。
  return sessions.filter((session) => {
    if (session.title.toLowerCase().includes(keyword)) return true;
    return session.messages.some((message) =>
      [message.content, message.think ?? '', ...(message.sources?.map((s) => s.title) ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  });
}

function formatRelativeShort(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const d = new Date(timestamp);
  const sameDay =
    new Date(now).toDateString() === d.toDateString();
  if (sameDay) return formatDate(d, 'HH:mm');
  return formatDate(d, 'MM-dd');
}
