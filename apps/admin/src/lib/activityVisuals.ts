import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  MessageSquare,
  Settings,
  Shield,
  Sparkles,
  User,
} from 'lucide-react';

export type ActivityCategoryKey =
  | 'post'
  | 'comment'
  | 'user'
  | 'system'
  | 'friend'
  | 'media'
  | 'ai'
  | 'security';

export type ActivityStatusKey = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface ActivityVisualConfig {
  icon: LucideIcon;
  label: string;
  tone: string;
}

export const activityCategoryConfig: Record<ActivityCategoryKey, ActivityVisualConfig> = {
  post: {
    icon: FileText,
    label: '文章',
    tone: 'oklch(0.62 0.17 260)',
  },
  comment: {
    icon: MessageSquare,
    label: '评论',
    tone: 'var(--signal-success, #22c55e)',
  },
  user: {
    icon: User,
    label: '用户',
    tone: 'oklch(0.62 0.16 290)',
  },
  system: {
    icon: Settings,
    label: '系统',
    tone: 'oklch(0.52 0.03 255)',
  },
  friend: {
    icon: LinkIcon,
    label: '友链',
    tone: 'oklch(0.63 0.17 330)',
  },
  media: {
    icon: ImageIcon,
    label: '媒体',
    tone: 'oklch(0.62 0.15 215)',
  },
  ai: {
    icon: Sparkles,
    label: 'AI',
    tone: 'oklch(0.65 0.17 280)',
  },
  security: {
    icon: Shield,
    label: '安全',
    tone: 'var(--signal-warn, #f59e0b)',
  },
};

export const activityStatusConfig: Record<ActivityStatusKey, { label: string; tone: string }> = {
  INFO: {
    label: '信息',
    tone: 'var(--ink-muted, #94a3b8)',
  },
  SUCCESS: {
    label: '成功',
    tone: 'var(--signal-success, #22c55e)',
  },
  WARNING: {
    label: '警告',
    tone: 'var(--signal-warn, #f59e0b)',
  },
  ERROR: {
    label: '错误',
    tone: 'var(--signal-danger, #ef4444)',
  },
};

export function getActivityCategoryConfig(category?: string | null): ActivityVisualConfig {
  return activityCategoryConfig[category as ActivityCategoryKey] ?? activityCategoryConfig.system;
}

export function getActivityStatusConfig(status?: string | null) {
  return activityStatusConfig[status as ActivityStatusKey] ?? activityStatusConfig.INFO;
}

export function getActivityVisual(category?: string | null, status?: string | null): ActivityVisualConfig {
  if (status === 'WARNING' || status === 'ERROR') {
    const statusConfig = getActivityStatusConfig(status);
    return {
      icon: AlertTriangle,
      label: statusConfig.label,
      tone: statusConfig.tone,
    };
  }

  return getActivityCategoryConfig(category);
}

export function activityToneStyle(tone: string): CSSProperties {
  return {
    '--activity-tone': tone,
  } as CSSProperties;
}

export function activityStatusPillStyle(tone: string): CSSProperties {
  return {
    color: tone,
    background: `color-mix(in oklch, ${tone} 12%, transparent)`,
    borderColor: `color-mix(in oklch, ${tone} 26%, transparent)`,
  };
}
