import { useState, useEffect, useRef, useCallback, lazy, Suspense, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, RefreshCw, Globe, Palette, Search, Database, Loader2, User, MessageSquare, Sparkles, Upload, X, ImageIcon, DatabaseZap, Type, Cloud, Check, ChevronDown, Settings2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { settingsService } from '@/services/settingsService';
import { mediaService, getMediaUrl } from '@/services/mediaService';
import { toast } from 'sonner';
import { SocialLinksEditor } from '@/components/settings/SocialLinksEditor';
import FontPickerModal, { getFontOption } from '@/components/settings/FontPickerModal';
import { useFontPreview } from '@/contexts/FontPreviewContext';
import { AdminModuleHeader } from '@/components/layout/AdminModuleHeader';
import { Toggle, Skeleton } from '@aetherblog/ui';
import {
  isNeutralPrimaryColor,
  PRESET_DARK_PRIMARY,
  PRESET_DARK_VISUAL_PRIMARY_HEX,
  PRESET_LIGHT_PRIMARY,
  PRESET_LIGHT_VISUAL_PRIMARY_HEX,
  resolveThemeVisualPrimaryMode,
  resolveVisualPrimaryColor,
} from '@aetherblog/utils';

const MigrationPage = lazy(() => import('./MigrationPage'));
// 存储管理 tab — Phase 2: 入口落在 /settings 顶层 tab 而非新页面,与现有 migration tab 同套机制
const StorageProviderSettings = lazy(() => import('./settings/StorageProviderSettings'));

// 设置元数据定义
// 帮助将原始键映射到 UI 标签和输入类型
type SettingFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'color' | 'url' | 'social-links' | 'image-upload' | 'font-picker' | 'select' | 'theme-preset-actions' | 'visual-color-preview';

interface SettingField {
  key: string;
  label: string;
  type: SettingFieldType;
  description?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string; description?: string }>;
}

const SETTING_GROUPS: Record<string, { label: string; icon: any; fields: SettingField[] }> = {
  general: {
    label: '基本设置',
    icon: Globe,
    fields: [
      { key: 'site_name', label: '站点名称', type: 'text', placeholder: 'AetherBlog' },
      { key: 'site_logo', label: '站点Logo', type: 'image-upload', description: '上传站点Logo图片，将替换导航栏中的默认字母图标。建议使用正方形透明背景的PNG图片' },
      { key: 'site_favicon', label: '站点图标 Favicon', type: 'image-upload', description: '浏览器标签页与 PWA 图标。留空则自动回退使用站点Logo。建议正方形 PNG/ICO' },
      { key: 'site_description', label: '站点描述', type: 'textarea', description: '用于 SEO 和首页展示' },
      { key: 'site_url', label: '站点地址', type: 'url', placeholder: 'https://example.com' },
      { key: 'site_keywords', label: '关键词', type: 'text', description: '逗号分隔，如: tech, blog, react' },
      { key: 'footer_text', label: '页脚文字', type: 'text' },
      { key: 'footer_signature', label: '个性签名', type: 'text' },
      { key: 'icp_number', label: 'ICP备案号', type: 'text' },
    ]
  },
  author: {
    label: '博主信息',
    icon: User,
    fields: [
      // 博主名称 / 头像 / 简介由「个人资料」(右上角头像菜单)统一维护——站点信息接口会以
      // 登录账号档案覆盖这三项，放在这里编辑不会生效，故移除以消除假配置。此处只保留
      // 真正由 site_settings 驱动的联系邮箱与社交链接。
      { key: 'author_email', label: '联系邮箱', type: 'text', description: '博主名称、头像、简介请在右上角「个人资料」中修改' },
      { key: 'social_links', label: '社交链接', type: 'social-links', description: '添加您的社交媒体账号' },
    ]
  },
  welcome: {
    label: '欢迎页设置',
    icon: Sparkles,
    fields: [
      { key: 'welcome_enabled', label: '启用欢迎页', type: 'boolean' },
      { key: 'welcome_title', label: '欢迎标题', type: 'text' },
      { key: 'welcome_subtitle', label: '欢迎副标题', type: 'text' },
      { key: 'welcome_description', label: '欢迎描述', type: 'textarea', placeholder: '智能写作、语义搜索、优雅呈现' },
      { key: 'welcome_primary_btn_text', label: '主按钮文案', type: 'text', placeholder: '浏览文章' },
      { key: 'welcome_primary_btn_link', label: '主按钮链接', type: 'text', placeholder: '/posts' },
      { key: 'welcome_secondary_btn_text', label: '副按钮文案', type: 'text', placeholder: '关于我' },
      { key: 'welcome_secondary_btn_link', label: '副按钮链接', type: 'text', placeholder: '/about' },
    ]
  },
  appearance: {
    label: '外观设置',
    icon: Palette,
    fields: [
      {
        key: 'theme_visual_color_mode',
        label: '主题配色方案',
        type: 'select',
        description: '默认使用产品预设 UI；用户切换为自定义后，才按主色生成 Aurora、图表和仪表盘色阶。',
        options: [
          { value: 'preset', label: '产品预设', description: '亮色黑色、暗色紫色，使用内置 UI 与色彩设计，不走自定义色谱' },
          { value: 'auto', label: '自定义主色', description: '彩色品牌色直接派生；黑/白/灰自动使用推荐 Aurora 光源' },
          { value: 'follow', label: '严格跟随主色', description: '强制用品牌主色派生，适合明确希望全站同色时使用' },
          { value: 'custom', label: '品牌色 + 视觉光源', description: '品牌色和图表光源完全分开控制' },
        ],
      },
      { key: 'theme_preset_actions', label: '产品预设', type: 'theme-preset-actions', description: '一键恢复默认配色、视觉光源模式与内置 UI 表现' },
      { key: 'theme_primary_color_light', label: '亮色主题主色调', type: 'color', description: '亮色主题下的品牌主色' },
      { key: 'theme_primary_color_dark', label: '暗色主题主色调', type: 'color', description: '暗色主题下的品牌主色' },
      { key: 'theme_visual_color_light', label: '亮色主题视觉光源', type: 'color', description: '自定义模式下生效；留空则自动使用推荐光源' },
      { key: 'theme_visual_color_dark', label: '暗色主题视觉光源', type: 'color', description: '自定义模式下生效；留空则自动使用推荐光源' },
      { key: 'theme_visual_color_preview', label: '视觉色阶预览', type: 'visual-color-preview', description: '展示当前设置实际用于图表和仪表盘的光源，避免黑色品牌色被静默映射' },
      { key: 'enable_dark_mode', label: '强制暗黑模式', type: 'boolean', description: '若关闭则跟随系统主题自动切换（如 iPhone 暗黑模式）' },
      { key: 'font_family', label: '全局字体', type: 'font-picker', description: '选择博客全局显示字体，支持预览体验' },
      // 首页欢迎页开关统一收敛到「欢迎页设置 → 启用欢迎页」(welcome_enabled)，移除此处重复的 show_banner。
      { key: 'post_page_size', label: '每页文章数', type: 'number', placeholder: '9', description: '文章列表页面的分页数量。默认 9，配合 3 列网格无尾行单卡' },
      { key: 'custom_css', label: '自定义 CSS', type: 'textarea', description: '注入博客前台的自定义样式，可用于替换背景图、调整间距等个性化定制。留空则使用默认样式' },
    ]
  },
  seo: {
    label: 'SEO 设置',
    icon: Search,
    fields: [
      { key: 'seo_robots', label: 'Robots.txt 内容', type: 'textarea' },
      { key: 'enable_sitemap', label: '启用 Sitemap', type: 'boolean' },
      { key: 'baidu_analytics_id', label: '百度统计 ID', type: 'text' },
      { key: 'google_analytics_id', label: 'Google Analytics ID', type: 'text' },
    ]
  },
  comment: {
    label: '评论设置',
    icon: MessageSquare,
    fields: [
      { key: 'comment_enabled', label: '启用评论', type: 'boolean' },
      { key: 'comment_audit', label: '评论需审核', type: 'boolean' },
    ]
  },
  advanced: {
    label: '高级设置',
    icon: Database,
    fields: [
      // 已移除的失效/重复项：
      //  · enable_registrations —— 系统无公开自助注册端点(/register 仅管理员)，开关无处生效。
      //  · storage_type —— 已由「存储管理」tab + storage_providers 表取代。
      //  · ai_enabled / ai_provider —— 已由「AI 配置」页 + 后端 config.AI 取代。
      { key: 'upload_max_size', label: '最大上传 (MB)', type: 'number', placeholder: '10', description: '单文件上传大小上限（MB），对图库与文章配图均生效。绝对硬上限 100MB；留空或填 0 视为 100MB。' },
      { key: 'editor_image_smart_compression_enabled', label: '编辑器图片智能压缩', type: 'boolean', description: '开启后，文章编辑器上传超过 5MB 的图片会自动压缩，并在活动记录中展示压缩效果。' },
    ]
  },
  migration: {
    label: '数据迁移',
    icon: DatabaseZap,
    fields: [] // 特殊 tab：不使用标准字段渲染，而是直接加载 MigrationPage 组件
  },
  storage: {
    label: '存储管理',
    icon: Cloud,
    fields: [] // 特殊 tab：直接加载 StorageProviderSettings 组件 (对象存储 rollout - Phase 2)
  }
};

const SETTING_GROUP_DESCRIPTIONS: Record<string, string> = {
  general: '站点标识、Logo、地址、备案与首页基础信息。',
  author: '联系邮箱与社交链接（名称 / 头像 / 简介请在「个人资料」维护）。',
  welcome: '首页欢迎页文案、行动按钮与入口开关。',
  appearance: '主题色、字体、暗黑模式、文章分页与自定义样式。',
  seo: '搜索引擎抓取、站点地图与统计代码配置。',
  comment: '评论入口和审核策略。',
  advanced: '上传大小限制与编辑器图片智能压缩。',
  migration: '导入历史博客数据并跟踪迁移进度。',
  storage: '管理本地、S3 兼容与云对象存储提供商。',
};

/** 图片上传字段组件 */
function ImageUploadField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const resolvedUrl = value ? getMediaUrl(value) : '';

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验文件类型
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    // 校验文件大小 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片大小不能超过 5MB');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await mediaService.upload(file, (percent) => {
        setUploadProgress(percent);
      });
      // Phase 3: 优先 cdnUrl(LOCAL=/api/uploads/...,云=完整 URL),fileUrl 兜底
      const url = result.cdnUrl || result.fileUrl;
      onChange(url);
      toast.success('Logo 上传成功');
    } catch {
      toast.error('Logo 上传失败');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      // 重置 input 以允许重复选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    onChange('');
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {resolvedUrl ? (
        <div className="flex items-center gap-4">
          {/* 预览 */}
          <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-input)] flex-shrink-0">
            <img
              src={resolvedUrl}
              alt="站点Logo"
              className="w-full h-full object-contain"
            />
          </div>
          {/* 操作 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)] transition-colors text-sm"
            >
              <Upload className="w-3.5 h-3.5" />
              更换
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors text-sm"
            >
              <X className="w-3.5 h-3.5" />
              移除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-muted)] hover:border-primary/40 hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] transition-all cursor-pointer"
        >
          {uploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">上传中 {uploadProgress}%</span>
            </>
          ) : (
            <>
              <ImageIcon className="w-5 h-5" />
              <span className="text-sm">点击上传Logo图片</span>
            </>
          )}
        </button>
      )}

      {/* 上传进度条 */}
      {uploading && (
        <div className="w-full h-1 rounded-full bg-[var(--bg-input)] overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${uploadProgress}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
      )}
    </div>
  );
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const NON_PERSISTED_SETTING_KEYS = new Set([
  'theme_preset_actions',
  'theme_visual_color_preview',
]);
const THEME_SETTING_KEYS = [
  'theme_visual_color_mode',
  'theme_primary_color',
  'theme_primary_color_light',
  'theme_primary_color_dark',
  'theme_visual_color_light',
  'theme_visual_color_dark',
] as const;
const THEME_PRESET_FORM_VALUES = {
  theme_visual_color_mode: 'preset',
  theme_primary_color: '',
  theme_primary_color_light: PRESET_LIGHT_PRIMARY,
  theme_primary_color_dark: PRESET_DARK_PRIMARY,
  theme_visual_color_light: '',
  theme_visual_color_dark: '',
};

function getColorInputValue(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  return HEX_COLOR_RE.test(text) ? text : fallback;
}

function resolveFormThemeMode(formData: Record<string, any>) {
  return resolveThemeVisualPrimaryMode({
    lightColor: typeof formData.theme_primary_color_light === 'string' ? formData.theme_primary_color_light : '',
    darkColor: typeof formData.theme_primary_color_dark === 'string' ? formData.theme_primary_color_dark : '',
    fallbackColor: typeof formData.theme_primary_color === 'string' ? formData.theme_primary_color : '',
    lightVisualColor: typeof formData.theme_visual_color_light === 'string' ? formData.theme_visual_color_light : '',
    darkVisualColor: typeof formData.theme_visual_color_dark === 'string' ? formData.theme_visual_color_dark : '',
    visualPrimaryMode: typeof formData.theme_visual_color_mode === 'string' ? formData.theme_visual_color_mode : '',
  });
}

function getFormThemeModeValue(formData: Record<string, any>) {
  const storedMode = typeof formData.theme_visual_color_mode === 'string'
    ? formData.theme_visual_color_mode
    : '';
  if (storedMode === 'preset' || storedMode === 'auto' || storedMode === 'follow' || storedMode === 'custom') {
    return storedMode;
  }
  return resolveFormThemeMode(formData);
}

function toSettingsStringMap(data: Record<string, any>, keys?: readonly string[]) {
  const stringMap: Record<string, string> = {};
  const sourceKeys = keys || Object.keys(data);

  sourceKeys.forEach(key => {
    if (NON_PERSISTED_SETTING_KEYS.has(key)) return;
    if (data[key] === undefined || data[key] === null) return;

    if (typeof data[key] === 'object') {
      stringMap[key] = JSON.stringify(data[key]);
    } else {
      stringMap[key] = String(data[key]);
    }
  });

  return stringMap;
}

function pickThemeSettings(data: Record<string, any>) {
  return THEME_SETTING_KEYS.reduce<Record<string, any>>((acc, key) => {
    if (data[key] !== undefined && data[key] !== null) {
      acc[key] = data[key];
    }
    return acc;
  }, {});
}

function getNextFormData(prev: Record<string, any>, key: string, value: any) {
  const currentMode = resolveFormThemeMode(prev);
  const next: Record<string, any> = { ...prev, [key]: value };

  if (key === 'theme_visual_color_mode' && value === 'preset') {
    Object.assign(next, THEME_PRESET_FORM_VALUES);
  }

  if (key === 'theme_visual_color_mode' && value !== 'preset' && currentMode === 'preset') {
    next.theme_primary_color_light = prev.theme_primary_color_light || PRESET_LIGHT_PRIMARY;
    next.theme_primary_color_dark = prev.theme_primary_color_dark || PRESET_DARK_PRIMARY;
  }

  if ((key === 'theme_primary_color_light' || key === 'theme_primary_color_dark') && currentMode === 'preset') {
    next.theme_visual_color_mode = 'auto';
  }

  if ((key === 'theme_visual_color_light' || key === 'theme_visual_color_dark') && currentMode !== 'custom') {
    next.theme_visual_color_mode = 'custom';
  }

  return next;
}

function VisualColorPreview({ formData }: { formData: Record<string, any> }) {
  const mode = resolveFormThemeMode(formData);
  const lightPrimary = getColorInputValue(
    formData.theme_primary_color_light || formData.theme_primary_color,
    PRESET_LIGHT_PRIMARY,
  );
  const darkPrimary = getColorInputValue(
    formData.theme_primary_color_dark || formData.theme_primary_color,
    PRESET_DARK_PRIMARY,
  );
  const previewLightPrimary = mode === 'preset' ? PRESET_LIGHT_PRIMARY : lightPrimary;
  const previewDarkPrimary = mode === 'preset' ? PRESET_DARK_PRIMARY : darkPrimary;
  const lightVisual = mode === 'preset' ? PRESET_LIGHT_VISUAL_PRIMARY_HEX : resolveVisualPrimaryColor(lightPrimary, false, {
    visualPrimaryMode: mode,
    visualPrimaryColor: getColorInputValue(formData.theme_visual_color_light, ''),
  });
  const darkVisual = mode === 'preset' ? PRESET_DARK_VISUAL_PRIMARY_HEX : resolveVisualPrimaryColor(darkPrimary, true, {
    visualPrimaryMode: mode,
    visualPrimaryColor: getColorInputValue(formData.theme_visual_color_dark, ''),
  });

  const modeLabel = {
    preset: '产品预设',
    auto: '自定义主色',
    follow: '严格跟随主色',
    custom: '品牌色 + 视觉光源',
  }[mode];

  const rows = [
    {
      label: '亮色主题',
      primary: previewLightPrimary,
      visual: lightVisual,
      neutral: isNeutralPrimaryColor(previewLightPrimary),
      defaultVisual: PRESET_LIGHT_VISUAL_PRIMARY_HEX,
    },
    {
      label: '暗色主题',
      primary: previewDarkPrimary,
      visual: darkVisual,
      neutral: isNeutralPrimaryColor(previewDarkPrimary),
      defaultVisual: PRESET_DARK_VISUAL_PRIMARY_HEX,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-1 rounded-md bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] text-[var(--aurora-1)] border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)]">
          当前模式：{modeLabel}
        </span>
        <span className="text-[var(--text-muted)]">
          {mode === 'preset'
            ? '使用产品内置的亮/暗两套 UI 与色彩，不进入自定义色谱计算。'
            : '品牌色负责按钮和选中态，视觉光源负责 Aurora、图表和仪表盘色阶。'}
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {rows.map((row) => {
          const usesFallback = mode === 'auto' && row.neutral;
          const previewStyle = {
            '--color-visual-primary': row.visual,
          } as CSSProperties;

          return (
            <div
              key={row.label}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{row.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {mode === 'preset'
                      ? '产品预设：使用内置方案，无需配置色谱'
                      : usesFallback
                      ? `低饱和品牌色保护：使用推荐光源 ${row.defaultVisual}`
                      : '使用下方实际光源生成色阶'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-6 w-6 rounded-md border border-[var(--border-subtle)]"
                    style={{ backgroundColor: row.primary }}
                    title={`品牌色 ${row.primary}`}
                  />
                  <span className="text-[var(--text-muted)]">→</span>
                  <span
                    className="h-6 w-6 rounded-md border border-[var(--border-subtle)]"
                    style={{ backgroundColor: row.visual }}
                    title={`视觉光源 ${row.visual}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                <span className="text-[var(--text-muted)]">品牌主色</span>
                <code className="font-mono text-[var(--text-secondary)]">{row.primary}</code>
                <span className="text-[var(--text-muted)]">实际光源</span>
                <code className="font-mono text-[var(--text-secondary)]">{row.visual}</code>
              </div>

              <div className="dashboard-page grid grid-cols-12 gap-1" style={previewStyle}>
                {Array.from({ length: 12 }, (_, index) => (
                  <span
                    key={index}
                    className="h-6 rounded-md border border-white/10 shadow-sm"
                    style={{ backgroundColor: `var(--dashboard-aurora-${index + 1})` }}
                    title={`aurora-${index + 1}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface AnimatedSelectFieldProps {
  value: string;
  options: Array<{ value: string; label: string; description?: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function AnimatedSelectField({ value, options, onChange, disabled }: AnimatedSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(option => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const commitValue = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(current => !current)}
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          'group w-full min-h-[56px] rounded-xl border bg-[var(--bg-input)] px-3.5 py-3 text-left transition-all',
          'flex items-center justify-between gap-3 shadow-sm',
          open
            ? 'border-primary/50 ring-2 ring-primary/15 shadow-lg shadow-primary/10'
            : 'border-[var(--border-subtle)] hover:border-primary/35 hover:bg-[var(--bg-card-hover)]',
          disabled && 'cursor-not-allowed opacity-60 hover:border-[var(--border-subtle)] hover:bg-[var(--bg-input)]',
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={cn(
            'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden',
            open && 'border-primary/30',
          )}>
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,var(--color-visual-primary)_0%,transparent_48%)] opacity-30" />
            <Palette className="relative h-4 w-4 text-primary" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
              {selectedOption?.label || '请选择'}
            </span>
            {selectedOption?.description && (
              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                {selectedOption.description}
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {disabled && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-[var(--text-muted)] transition-transform duration-200',
              open && 'rotate-180 text-primary',
            )}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-popover)] shadow-2xl shadow-black/10 backdrop-blur-xl"
            role="listbox"
          >
            <div className="max-h-72 overflow-y-auto p-1.5">
              {options.map(option => {
                const selected = option.value === value;
                return (
                  <motion.button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => commitValue(option.value)}
                    initial={false}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.99 }}
                    className={cn(
                      'w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                      'flex items-start justify-between gap-3',
                      selected
                        ? 'bg-primary/10 text-primary'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {option.label}
                      </span>
                      {option.description && (
                        <span className={cn(
                          'mt-0.5 block text-xs leading-relaxed',
                          selected ? 'text-primary/75' : 'text-[var(--text-muted)]',
                        )}>
                          {option.description}
                        </span>
                      )}
                    </span>
                    <span className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all',
                      selected
                        ? 'border-primary bg-primary text-white'
                        : 'border-[var(--border-subtle)] text-transparent',
                    )}>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SETTINGS_PANEL_BORDER = 'border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]';

/** 左侧导航骨架 —— 复用真实导航的结构类，保证加载态与最终布局零位移。 */
function SettingsNavSkeleton() {
  return (
    <aside className={cn('settings-nav-panel access-surface rounded-xl', SETTINGS_PANEL_BORDER)} aria-hidden="true">
      <div className="settings-nav-heading">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="settings-nav-list">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="settings-nav-button" style={{ pointerEvents: 'none' }}>
            <span className="settings-nav-icon">
              <Skeleton variant="rectangular" className="h-4 w-4" />
            </span>
            <span className="settings-nav-copy">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-1.5 h-2.5 w-32" />
            </span>
            <Skeleton className="settings-nav-count h-3 w-8" />
          </div>
        ))}
      </div>
    </aside>
  );
}

/** 字段列表骨架 —— 复用 settings-field-row 让标签/控件间距与真实表单一致。 */
function SettingsFieldListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="settings-field-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="settings-field-row">
          <div className="settings-field-copy">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-44" />
          </div>
          <div className="settings-field-control">
            <Skeleton variant="rectangular" className="h-10 w-full max-w-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 整页骨架 —— 替代禁用的全屏 spinner（设计系统 §3.6），结构与已加载页面对齐。 */
function SettingsPageSkeleton() {
  return (
    <div className="admin-grid-page settings-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <div className={cn('access-surface rounded-xl p-5', SETTINGS_PANEL_BORDER)}>
          <div className="flex items-center gap-3">
            <Skeleton variant="rectangular" className="h-10 w-10" />
            <div className="flex-1">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-3 w-72" />
            </div>
          </div>
        </div>
        <div className="settings-layout">
          <SettingsNavSkeleton />
          <section className={cn('settings-detail-panel access-surface rounded-xl', SETTINGS_PANEL_BORDER)}>
            <div className="settings-detail-inner">
              <div className="settings-detail-header">
                <div className="settings-detail-title-row">
                  <Skeleton variant="rectangular" className="h-9 w-9" />
                  <div>
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="mt-2 h-3 w-56" />
                  </div>
                </div>
              </div>
              <SettingsFieldListSkeleton rows={6} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const settingsNavRef = useRef<HTMLElement | null>(null);
  const settingsNavButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // 本地状态表单数据（用于保存前编辑）
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // 字体选择器状态
  const [fontModalOpen, setFontModalOpen] = useState(false);
  const { startPreview, applyPreview } = useFontPreview();

  const queryClient = useQueryClient();

  // 查询：获取所有设置
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.getAll(),
  });

  // 同步服务器数据到本地表单数据
  // 注意：依赖仅包含 settings，不包含 hasChanges。
  // 当 settings 变化时（首次加载或保存后 refetch），效果运行并读取当前 hasChanges 值。
  // 若将 hasChanges 加入依赖，保存后 hasChanges→false 会立即触发 setFormData(旧settings)，
  // 导致刚上传的 site_logo 等新值被旧数据覆盖（refetch 尚未完成），引发 UI 闪烁。
  useEffect(() => {
    if (settings) {
      if (hasChanges) {
        // 保留本地更改，同时合入新的服务器数据
        setFormData(prev => ({
          ...settings,
          ...prev
        }));
      } else {
        // 全新加载或保存后刷新，使用服务器数据
        setFormData(settings);
      }
    }
  }, [settings]);

  // 变更：批量更新
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      return settingsService.batchUpdate(toSettingsStringMap(data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-site-info'] });
      toast.success('设置已保存');
      setHasChanges(false);
    },
    onError: () => {
      toast.error('保存失败');
    }
  });

  const themeSettingsMutation = useMutation({
    mutationFn: (data: Record<string, any>) => {
      return settingsService.batchUpdate(toSettingsStringMap(data, THEME_SETTING_KEYS));
    },
    onSuccess: (_, data) => {
      const themePatch = pickThemeSettings(data);
      queryClient.setQueryData<Record<string, any>>(['settings'], old => ({
        ...(old || {}),
        ...themePatch,
      }));
      toast.success('主题配色方案已应用');
    },
    onError: () => {
      toast.error('主题配色方案保存失败');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const handleInputChange = (key: string, value: any) => {
    setFormData(prev => getNextFormData(prev, key, value));
    setHasChanges(true);
  };

  const handleThemeModeChange = (value: string) => {
    const nextData = getNextFormData(formData, 'theme_visual_color_mode', value);
    const themePatch = pickThemeSettings(nextData);
    setFormData(nextData);
    queryClient.setQueryData<Record<string, any>>(['settings'], old => ({
      ...(old || {}),
      ...themePatch,
    }));
    themeSettingsMutation.mutate(nextData);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const handleReset = () => {
    if (settings) {
      setFormData(settings);
      setHasChanges(false);
      toast.success('已重置更改');
    }
  };

  const handleResetThemePreset = () => {
    const nextData = {
      ...formData,
      ...THEME_PRESET_FORM_VALUES,
    };
    const themePatch = pickThemeSettings(nextData);
    setFormData(nextData);
    queryClient.setQueryData<Record<string, any>>(['settings'], old => ({
      ...(old || {}),
      ...themePatch,
    }));
    themeSettingsMutation.mutate(nextData);
  };

  // 字体预览：临时体验 2 分钟（通过全局 context）
  const handleFontPreview = useCallback((fontId: string) => {
    startPreview(fontId);
    setFontModalOpen(false);
    toast.success(`已开启「${getFontOption(fontId)?.name}」字体体验，2 分钟后自动还原`);
  }, [startPreview]);

  // 从字体选择器直接应用 → 通过全局 context 保存
  const handleFontSelect = useCallback((fontId: string) => {
    setFormData(prev => ({ ...prev, font_family: fontId }));
    applyPreview(fontId);
  }, [applyPreview]);

  const syncSettingsNavSlider = useCallback((centerSelected = false) => {
    const nav = settingsNavRef.current;
    const button = settingsNavButtonRefs.current[activeTab];
    if (!nav || !button) return;

    nav.style.setProperty('--settings-nav-slider-x', `${button.offsetLeft}px`);
    nav.style.setProperty('--settings-nav-slider-y', `${button.offsetTop}px`);
    nav.style.setProperty('--settings-nav-slider-width', `${button.offsetWidth}px`);
    nav.style.setProperty('--settings-nav-slider-height', `${button.offsetHeight}px`);

    if (centerSelected) {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      button.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [activeTab]);

  useEffect(() => {
    let frame = window.requestAnimationFrame(() => syncSettingsNavSlider(true));

    const handleResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => syncSettingsNavSlider(false));
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
  }, [syncSettingsNavSlider]);

  const activeGroup = SETTING_GROUPS[activeTab];
  const ActiveGroupIcon = activeGroup.icon;
  const activeGroupDescription = SETTING_GROUP_DESCRIPTIONS[activeTab] || `管理您的${activeGroup.label}`;
  const activeGroupFieldCount = activeGroup.fields.length;
  const isSpecialTab = activeTab === 'migration' || activeTab === 'storage';
  const settingsActions = hasChanges ? (
    <motion.div
      key="settings-actions"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="settings-header-actions"
    >
      <button
        type="button"
        onClick={handleReset}
        className="settings-action-button"
      >
        <RefreshCw className="h-4 w-4" />
        重置
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={saveMutation.isPending}
        className="settings-action-button settings-action-button-primary"
      >
        {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        保存更改
      </button>
    </motion.div>
  ) : undefined;

  if (isLoading) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="admin-grid-page settings-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          className="settings-stateful-actions-module-header"
          title="系统设置"
          icon={Settings2}
          currentLabel={activeGroup.label}
          description="统一维护站点基础、外观、SEO、评论、存储与高级运行参数。"
          activeSummary={`当前工作区：${activeGroup.label} · ${activeGroupDescription}${hasChanges ? ' · 存在未保存更改' : ''}`}
          actions={settingsActions}
        />

        <div className="settings-layout">
          <aside className="settings-nav-panel access-surface rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]" aria-label="系统设置分类">
            <div className="settings-nav-heading">
              <span>设置分类</span>
              <small>{Object.keys(SETTING_GROUPS).length} 个模块</small>
            </div>
            <nav ref={settingsNavRef} className="settings-nav-list">
              <span className="settings-nav-slider" aria-hidden="true" />
              {Object.entries(SETTING_GROUPS).map(([key, group]) => {
                const Icon = group.icon;
                const active = activeTab === key;
                const countText = group.fields.length > 0 ? `${group.fields.length} 项` : '模块';
                return (
                  <button
                    key={key}
                    ref={(node) => {
                      settingsNavButtonRefs.current[key] = node;
                    }}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    data-active={active}
                    aria-current={active ? 'page' : undefined}
                    className="settings-nav-button"
                  >
                    <span className="settings-nav-icon">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="settings-nav-copy">
                      <span className="settings-nav-label">{group.label}</span>
                      <span className="settings-nav-description">{SETTING_GROUP_DESCRIPTIONS[key]}</span>
                    </span>
                    <span className="settings-nav-count">{countText}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <motion.section
            layout="position"
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="settings-detail-panel access-surface rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]"
            aria-label={activeGroup.label}
          >
            <div className="settings-detail-inner">
              {isSpecialTab ? (
                activeTab === 'migration' ? (
                  <Suspense fallback={<SettingsFieldListSkeleton rows={5} />}>
                    <MigrationPage />
                  </Suspense>
                ) : (
                  <Suspense fallback={<SettingsFieldListSkeleton rows={5} />}>
                    <StorageProviderSettings />
                  </Suspense>
                )
              ) : (
                <>
                  <div className="settings-detail-header">
                    <div className="settings-detail-title-row">
                      <span className="settings-detail-icon" aria-hidden="true">
                        <ActiveGroupIcon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="settings-detail-title">{activeGroup.label}</h2>
                        <p className="settings-detail-description">
                          {activeGroupDescription} 所有更改需保存后生效。
                        </p>
                      </div>
                    </div>
                    <span className="settings-detail-count">{activeGroupFieldCount} 项配置</span>
                  </div>

                  <div className="settings-field-list">
                    {activeGroup.fields.map((field) => {
                      const isOn = formData[field.key] === 'true' || formData[field.key] === true;
                      return (
                        <div key={field.key} className="settings-field-row" data-field-type={field.type}>
                          <div className="settings-field-copy">
                            <label className="settings-field-label">
                              {field.label}
                            </label>
                            {field.description && (
                              <p className="settings-field-description">{field.description}</p>
                            )}
                          </div>
                          <div className="settings-field-control">

                      {/* 动态字段渲染 */}
                      {field.type === 'text' || field.type === 'url' || field.type === 'number' ? (
                        <input
                          type={field.type}
                          value={formData[field.key] || ''}
                          onChange={(e) => handleInputChange(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all"
                        />
                      ) : field.type === 'textarea' ? (
                        <textarea
                          rows={4}
                          value={formData[field.key] || ''}
                          onChange={(e) => handleInputChange(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-[var(--text-muted)] transition-all resize-none font-mono"
                        />
                      ) : field.type === 'boolean' ? (
                        <div className="flex items-center gap-3">
                          <Toggle
                            checked={isOn}
                            onChange={(next) => handleInputChange(field.key, next)}
                          />
                          <span className="text-sm text-[var(--text-muted)]">
                            {isOn ? '已开启' : '已关闭'}
                          </span>
                        </div>
                      ) : field.type === 'select' ? (
                        <AnimatedSelectField
                          value={field.key === 'theme_visual_color_mode'
                            ? getFormThemeModeValue(formData)
                            : formData[field.key] || field.options?.[0]?.value || ''}
                          options={field.options || []}
                          disabled={field.key === 'theme_visual_color_mode' && themeSettingsMutation.isPending}
                          onChange={(value) => {
                            if (field.key === 'theme_visual_color_mode') {
                              handleThemeModeChange(value);
                            } else {
                              handleInputChange(field.key, value);
                            }
                          }}
                        />
                      ) : field.type === 'theme-preset-actions' ? (
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-[var(--text-primary)]">
                                产品预设：亮色黑色 + 暗色紫色
                              </p>
                              <p className="text-xs text-[var(--text-muted)]">
                                恢复内置品牌色、视觉光源模式和仪表盘预设 UI。用户未自定义时会一直使用这套确定设计。
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleResetThemePreset}
                              disabled={themeSettingsMutation.isPending}
                              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {themeSettingsMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <RefreshCw className="w-4 h-4" />
                              )}
                              恢复产品预设
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] px-2 py-2">
                              <span className="h-5 w-5 rounded-md border border-[var(--border-subtle)]" style={{ backgroundColor: PRESET_LIGHT_PRIMARY }} />
                              <span className="text-[var(--text-muted)]">亮色品牌色</span>
                              <code className="ml-auto text-[var(--text-secondary)]">{PRESET_LIGHT_PRIMARY}</code>
                            </div>
                            <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] px-2 py-2">
                              <span className="h-5 w-5 rounded-md border border-[var(--border-subtle)]" style={{ backgroundColor: PRESET_DARK_PRIMARY }} />
                              <span className="text-[var(--text-muted)]">暗色品牌色</span>
                              <code className="ml-auto text-[var(--text-secondary)]">{PRESET_DARK_PRIMARY}</code>
                            </div>
                          </div>
                        </div>
                      ) : field.type === 'color' ? (
                        (() => {
                          const mode = resolveFormThemeMode(formData);
                          const isVisualColorField = field.key === 'theme_visual_color_light' || field.key === 'theme_visual_color_dark';
                          const colorDisabled = mode === 'preset' || (isVisualColorField && mode !== 'custom');
                          const fallback = field.key.includes('_dark')
                            ? (isVisualColorField ? PRESET_DARK_VISUAL_PRIMARY_HEX : PRESET_DARK_PRIMARY)
                            : (isVisualColorField ? PRESET_LIGHT_VISUAL_PRIMARY_HEX : PRESET_LIGHT_PRIMARY);
                          const value = mode === 'preset'
                            ? fallback
                            : getColorInputValue(formData[field.key], fallback);
                          const textValue = mode === 'preset'
                            ? fallback
                            : formData[field.key] || '';

                          return (
                            <div className={cn('flex items-center gap-3', colorDisabled && 'opacity-55')}>
                              <input
                                type="color"
                                value={value}
                                onChange={(e) => handleInputChange(field.key, e.target.value)}
                                disabled={colorDisabled}
                                className="bg-transparent border-0 w-10 h-10 p-0 cursor-pointer overflow-hidden rounded-lg disabled:cursor-not-allowed"
                              />
                              <input
                                type="text"
                                value={textValue}
                                onChange={(e) => handleInputChange(field.key, e.target.value)}
                                disabled={colorDisabled}
                                placeholder={fallback}
                                className="w-32 px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm focus:border-primary/50 focus:outline-none font-mono disabled:cursor-not-allowed"
                              />
                              {colorDisabled && (
                                <span className="text-xs text-[var(--text-muted)]">
                                  {mode === 'preset' ? '切换为自定义配色后可编辑' : '切换为品牌色 + 视觉光源后可编辑'}
                                </span>
                              )}
                            </div>
                          );
                        })()
                      ) : field.type === 'visual-color-preview' ? (
                        <VisualColorPreview formData={formData} />
                      ) : field.type === 'social-links' ? (
                        <SocialLinksEditor
                          value={(() => {
                            // 解析 social_links，可能是 JSON 字符串或已解析的数组
                            const raw = formData[field.key];
                            if (!raw) return [];
                            if (Array.isArray(raw)) return raw;
                            try {
                              return JSON.parse(raw);
                            } catch {
                              return [];
                            }
                          })()}
                          onChange={(links) => handleInputChange(field.key, links)}
                        />
                      ) : field.type === 'image-upload' ? (
                        <ImageUploadField
                          value={formData[field.key] || ''}
                          onChange={(url) => handleInputChange(field.key, url)}
                        />
                      ) : field.type === 'font-picker' ? (
                        <div className="space-y-2">
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                            <div className="flex-1 min-w-0 px-3 py-2.5 bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-sm">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <Type className="w-4 h-4 text-primary" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-[var(--text-primary)] text-sm truncate">
                                    {getFontOption(formData[field.key] || 'system')?.name || '系统默认'}
                                  </p>
                                  <p className="text-xs text-[var(--text-muted)] truncate">
                                    {getFontOption(formData[field.key] || 'system')?.description}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setFontModalOpen(true)}
                              className="px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors shrink-0 text-center"
                            >
                              选择字体
                            </button>
                          </div>
                        </div>
                      ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </motion.section>
        </div>
      </div>

      {/* 字体选择弹窗 */}
      <FontPickerModal
        open={fontModalOpen}
        currentFont={formData.font_family || 'system'}
        onClose={() => setFontModalOpen(false)}
        onSelect={handleFontSelect}
        onPreview={handleFontPreview}
      />
    </div>
  );
}
