import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Check,
  ChevronRight,
  Edit3,
  FileText,
  Folder,
  ImageIcon,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Select, type SelectOption } from '@aetherblog/ui';
import { cn, formatDateTime } from '@/lib/utils';
import { AdminModuleHeader, type AdminModuleHeaderTab } from '@/components/layout/AdminModuleHeader';
import { accessService } from '@/services/accessService';
import { getMediaUrl } from '@/services/mediaService';
import type {
  ContentPermissionLevel,
  ContentShare,
  ManagedUser,
  Permission,
  Role,
  SharePrincipalType,
  ShareableResource,
  SharedResourceType,
  Team,
  TeamMember,
  UserStatus,
} from '@aetherblog/types';

type TabKey = 'users' | 'roles' | 'teams' | 'shares';

const tabs: Array<AdminModuleHeaderTab<TabKey>> = [
  { key: 'users', label: '用户', shortLabel: '用户', description: '账号、状态与安全操作', icon: Users },
  { key: 'roles', label: '角色权限', shortLabel: '角色', description: '角色权限矩阵与授权范围', icon: ShieldCheck },
  { key: 'teams', label: '团队', shortLabel: '团队', description: '团队资料、成员与身份', icon: UserPlus },
  { key: 'shares', label: '内容共享', shortLabel: '共享', description: '跨资源授权与过期策略', icon: Share2 },
];

const roleOptions: SelectOption[] = [
  { value: 'ADMIN', label: '系统管理员', description: '系统全部权限' },
  { value: 'AUTHOR', label: '作者', description: '文章与媒体内容生产' },
  { value: 'USER', label: '普通用户', description: '登录和访问被共享内容' },
];

const statusOptions: SelectOption[] = [
  { value: 'ACTIVE', label: '正常' },
  { value: 'INACTIVE', label: '停用' },
  { value: 'BANNED', label: '封禁' },
];

const teamVisibilityOptions: SelectOption[] = [
  { value: 'PRIVATE', label: '私有' },
  { value: 'INTERNAL', label: '内部' },
  { value: 'PUBLIC', label: '公开' },
];

const memberRoleOptions: SelectOption[] = [
  { value: 'OWNER', label: '所有者' },
  { value: 'MANAGER', label: '管理员' },
  { value: 'MEMBER', label: '成员' },
  { value: 'VIEWER', label: '观察者' },
];

const memberStatusOptions: SelectOption[] = [
  { value: 'ACTIVE', label: '正常' },
  { value: 'INVITED', label: '已邀请' },
  { value: 'DISABLED', label: '停用' },
];

const resourceTypeOptions: SelectOption[] = [
  { value: 'POST', label: '文章', icon: FileText },
  { value: 'MEDIA_FILE', label: '媒体文件', icon: ImageIcon },
  { value: 'MEDIA_FOLDER', label: '媒体文件夹', icon: Folder },
];

const principalTypeOptions: SelectOption[] = [
  { value: 'USER', label: '用户' },
  { value: 'TEAM', label: '团队' },
  { value: 'ROLE', label: '角色' },
];

const contentPermissionOptions: SelectOption[] = [
  { value: 'VIEW', label: '查看' },
  { value: 'COMMENT', label: '评论' },
  { value: 'EDIT', label: '编辑' },
  { value: 'MANAGE', label: '管理' },
];

const roleLabelMap = new Map(roleOptions.map((item) => [item.value, item.label]));
const statusLabelMap = new Map(statusOptions.map((item) => [item.value, item.label]));
const visibilityLabelMap = new Map(teamVisibilityOptions.map((item) => [item.value, item.label]));
const memberRoleLabelMap = new Map(memberRoleOptions.map((item) => [item.value, item.label]));
const memberStatusLabelMap = new Map(memberStatusOptions.map((item) => [item.value, item.label]));
const resourceTypeLabelMap = new Map(resourceTypeOptions.map((item) => [item.value, item.label]));
const principalTypeLabelMap = new Map(principalTypeOptions.map((item) => [item.value, item.label]));
const contentPermissionLabelMap = new Map(contentPermissionOptions.map((item) => [item.value, item.label]));
const shareResourceLoadLimit = 1000;
const userPickerPageSize = 100;

const inputClass = cn(
  'h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
  'bg-[var(--bg-leaf)] px-3 text-sm text-[var(--ink-primary)]',
  'placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
);

const panelClass = cn(
  'access-surface surface-leaf surface-admin-panel rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)]',
  'p-3 shadow-sm sm:p-5'
);

const shellClass = cn(
  'access-surface rounded-xl border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] sm:rounded-2xl',
  'bg-[var(--bg-leaf)] shadow-[0_18px_48px_-42px_rgba(0,0,0,0.45)]'
);

const toDateTime = (value?: string | null) => {
  if (!value) return '尚无记录';
  return formatDateTime(value);
};

const userDisplayName = (user: ManagedUser | TeamMember) => {
  const id = 'userId' in user ? user.userId : user.id;
  return user.nickname || user.username || `用户 #${id}`;
};

const roleLabel = (role: string) => roleLabelMap.get(role) || role;

const parseOptionalNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const makeUserOptions = (users: ManagedUser[]): SelectOption[] => [
  { value: '', label: '未指定' },
  ...users.map((user) => ({
    value: String(user.id),
    label: `${userDisplayName(user)} · ${user.email}`,
    description: `#${user.id} · ${(user.roles?.length ? user.roles : [user.role]).map(roleLabel).join(' / ')}`,
  })),
];

async function listAllUsersForPicker(): Promise<ManagedUser[]> {
  const first = await accessService.listUsers({ pageNum: 1, pageSize: userPickerPageSize });
  if (first.code !== 200 || !first.data) return [];
  const pages = Math.max(1, first.data.pages || Math.ceil(first.data.total / first.data.pageSize));
  if (pages <= 1) return first.data.list;

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) =>
      accessService.listUsers({ pageNum: index + 2, pageSize: userPickerPageSize })
    )
  );
  const byId = new Map<number, ManagedUser>();
  for (const user of first.data.list) byId.set(user.id, user);
  for (const res of rest) {
    if (res.code !== 200 || !res.data) continue;
    for (const user of res.data.list) byId.set(user.id, user);
  }
  return Array.from(byId.values());
}

const makeResourceKey = (resourceType: SharedResourceType, id: number) => `${resourceType}:${id}`;

const resourceOption = (resource: ShareableResource): SelectOption => ({
  value: String(resource.id),
  label: resource.title,
  description: [
    `#${resource.id}`,
    resource.status,
    resource.subtitle,
  ].filter(Boolean).join(' · '),
});

export default function AccessControlPage() {
  const [tab, setTab] = useState<TabKey>('users');

  return (
    <div className="access-control-page -m-4 min-h-[calc(100%+2rem)] overflow-hidden p-4 text-[var(--ink-primary)] md:-m-6 md:min-h-[calc(100%+3rem)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-0 py-2 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
        <AdminModuleHeader
          title="身份与共享"
          description="统一管理账号、角色、团队与跨资源共享策略。"
          tabs={tabs}
          activeKey={tab}
          onTabChange={setTab}
        />

        {tab === 'users' && <UsersPanel />}
        {tab === 'roles' && <RolesPanel />}
        {tab === 'teams' && <TeamsPanel />}
        {tab === 'shares' && <SharesPanel />}
      </div>
    </div>
  );
}

function UsersPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    password: '',
    nickname: '',
    status: 'ACTIVE' as UserStatus,
    roleCodes: ['USER'],
    mustChangePassword: true,
  });

  const queryParams = useMemo(() => ({
    search: search.trim() || undefined,
    role: roleFilter || undefined,
    status: statusFilter || undefined,
    pageNum: 1,
    pageSize: 30,
  }), [search, roleFilter, statusFilter]);

  const usersQuery = useQuery({
    queryKey: ['access-users', queryParams],
    queryFn: async () => {
      const res = await accessService.listUsers(queryParams);
      return res.code === 200 ? res.data : { list: [], total: 0, pageNum: 1, pageSize: 30, pages: 0 };
    },
  });

  const createMutation = useMutation({
    mutationFn: () => accessService.createUser(createForm),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('用户已创建');
      setShowCreate(false);
      setCreateForm({ username: '', email: '', password: '', nickname: '', status: 'ACTIVE', roleCodes: ['USER'], mustChangePassword: true });
      queryClient.invalidateQueries({ queryKey: ['access-users'] });
    },
    onError: (err: any) => toast.error(err?.message || '创建用户失败'),
  });

  const users = usersQuery.data?.list ?? [];
  const activeCount = users.filter((user) => user.status === 'ACTIVE').length;
  const adminCount = users.filter((user) => (user.roles?.length ? user.roles : [user.role]).includes('ADMIN')).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <MetricCard label="当前结果" value={usersQuery.data?.total ?? users.length} helper="匹配筛选条件的用户" />
        <MetricCard label="正常账号" value={activeCount} helper="当前页 ACTIVE 用户" tone="success" />
        <MetricCard label="管理员" value={adminCount} helper="当前页 ADMIN 授权" tone="warn" />
      </div>

      <section className={panelClass}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto] lg:items-center">
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索用户名、邮箱或昵称"
              className={cn(inputClass, 'pl-9')}
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter} options={[{ value: '', label: '全部角色' }, ...roleOptions]} />
          <Select value={statusFilter} onValueChange={setStatusFilter} options={[{ value: '', label: '全部状态' }, ...statusOptions]} />
          <Button onClick={() => setShowCreate((v) => !v)} className="col-span-2 gap-2 lg:col-span-1">
            <Plus className="h-4 w-4" />
            新建用户
          </Button>
        </div>

        {showCreate && (
          <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/55 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--ink-primary)]">创建账号</h2>
                <p className="text-xs text-[var(--ink-muted)]">初始密码必须符合后端复杂度策略。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]"
                aria-label="关闭创建用户表单"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="用户名">
                <input className={inputClass} value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} />
              </Field>
              <Field label="邮箱">
                <input className={inputClass} value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
              </Field>
              <Field label="初始密码">
                <input className={inputClass} type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
              </Field>
              <Field label="昵称">
                <input className={inputClass} value={createForm.nickname} onChange={(e) => setCreateForm({ ...createForm, nickname: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto] lg:items-end">
              <Field label="角色">
                <RoleToggle value={createForm.roleCodes} onChange={(roleCodes) => setCreateForm({ ...createForm, roleCodes })} />
              </Field>
              <Field label="状态">
                <Select value={createForm.status} onValueChange={(status) => setCreateForm({ ...createForm, status: status as UserStatus })} options={statusOptions} />
              </Field>
              <label className="flex h-10 items-center gap-2 text-sm text-[var(--ink-secondary)]">
                <input
                  type="checkbox"
                  checked={createForm.mustChangePassword}
                  onChange={(e) => setCreateForm({ ...createForm, mustChangePassword: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border-subtle)]"
                />
                首次登录改密
              </label>
              <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending} className="gap-2">
                <Check className="h-4 w-4" />
                保存
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className={cn(shellClass, 'overflow-hidden')}>
        <div className="access-table-scroll hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
              <col className="w-[10%]" />
              <col className="w-[20%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="bg-[var(--bg-leaf)] text-left text-xs uppercase text-[var(--ink-muted)]">
              <tr>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">账号</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">登录</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-primary)]">
              {users.map((user) => (
                <UserTableRow key={user.id} user={user} onEdit={() => setEditingUser(user)} />
              ))}
              {!usersQuery.isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[var(--ink-muted)]">暂无用户</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-3 md:hidden">
          {users.map((user) => (
            <UserCard key={user.id} user={user} onEdit={() => setEditingUser(user)} />
          ))}
          {!usersQuery.isLoading && users.length === 0 && <EmptyState text="暂无用户" />}
        </div>
      </section>

      <UserEditorDrawer user={editingUser} onClose={() => setEditingUser(null)} />
    </div>
  );
}

function UserTableRow({ user, onEdit }: { user: ManagedUser; onEdit: () => void }) {
  const roles = user.roles?.length ? user.roles : [user.role || 'USER'];
  return (
    <tr className="align-middle hover:bg-[var(--bg-card-hover)]">
      <td className="px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar user={user} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-[var(--ink-primary)]">{userDisplayName(user)}</div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--ink-muted)]">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-all">{user.email}</span>
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 align-middle">
        <span className="block truncate font-mono text-xs text-[var(--ink-secondary)]" title={user.username}>
          {user.username}
        </span>
      </td>
      <td className="px-4 py-4">
        <RoleBadges roles={roles} />
      </td>
      <td className="px-4 py-4">
        <StatusBadge status={user.status} />
        {user.mustChangePassword && (
          <div className="mt-2 text-xs text-[var(--ink-muted)]">需改密</div>
        )}
      </td>
      <td className="px-4 py-4 text-xs text-[var(--ink-muted)]">
        <div className="tnum flex items-center gap-1.5 whitespace-nowrap font-mono">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          {toDateTime(user.lastLoginAt)}
        </div>
      </td>
      <td className="px-4 py-4">
        <Button size="sm" variant="secondary" onClick={onEdit} className="h-9 min-w-[84px] shrink-0 whitespace-nowrap px-3 gap-1.5">
          <Edit3 className="h-3.5 w-3.5" />
          编辑
        </Button>
      </td>
    </tr>
  );
}

function UserCard({ user, onEdit }: { user: ManagedUser; onEdit: () => void }) {
  const roles = user.roles?.length ? user.roles : [user.role || 'USER'];
  return (
    <button
      type="button"
      onClick={onEdit}
      className="access-user-card rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-leaf)] p-4 pl-5 text-left active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar user={user} />
          <div className="min-w-0">
            <div className="break-words text-base font-semibold text-[var(--ink-primary)]">{userDisplayName(user)}</div>
            <div className="mt-1 grid gap-0.5 text-xs text-[var(--ink-muted)]">
              <span className="break-all">账号：{user.username}</span>
              <span className="break-all">邮箱：{user.email}</span>
            </div>
          </div>
        </div>
        <StatusBadge status={user.status} />
      </div>
      <div className="mt-3">
        <RoleBadges roles={roles} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--ink-muted)]">
        <span>{user.mustChangePassword ? '下次登录需改密' : '密码状态正常'}</span>
        <span className="inline-flex items-center gap-1 text-[var(--aurora-1)]">
          编辑
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

function UserEditorDrawer({ user, onClose }: { user: ManagedUser | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<string[]>(['USER']);
  const [status, setStatus] = useState<UserStatus>('ACTIVE');
  const [mustChange, setMustChange] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!user) return;
    setRoles(user.roles?.length ? user.roles : [user.role || 'USER']);
    setStatus(user.status);
    setMustChange(user.mustChangePassword);
    setPassword('');
  }, [user]);

  const updateMutation = useMutation({
    mutationFn: () => accessService.updateUser(user!.id, { status, roleCodes: roles, mustChangePassword: mustChange }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('用户已更新');
      queryClient.invalidateQueries({ queryKey: ['access-users'] });
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || '更新用户失败'),
  });

  const resetMutation = useMutation({
    mutationFn: () => accessService.resetPassword(user!.id, { password, mustChangePassword: true }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('密码已重置');
      setPassword('');
      queryClient.invalidateQueries({ queryKey: ['access-users'] });
    },
    onError: (err: any) => toast.error(err?.message || '重置密码失败'),
  });

  if (!user || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="关闭用户编辑"
        onClick={onClose}
      />
      <aside className="fixed inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border border-[var(--border-subtle)] bg-[var(--bg-leaf)] shadow-2xl md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:w-[420px] md:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">User Access</p>
            <h2 className="mt-1 truncate text-lg font-bold text-[var(--ink-primary)]">{userDisplayName(user)}</h2>
            <p className="truncate text-xs text-[var(--ink-muted)]">{user.username} · {user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-[var(--ink-primary)]">身份授权</h3>
            <RoleToggle value={roles} onChange={setRoles} />
          </section>

          <section className="grid gap-3">
            <Field label="账号状态">
              <Select value={status} onValueChange={(v) => setStatus(v as UserStatus)} options={statusOptions} />
            </Field>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/60 px-3 py-2 text-sm text-[var(--ink-secondary)]">
              <span>
                <span className="block font-medium text-[var(--ink-primary)]">强制下次登录改密</span>
                <span className="text-xs text-[var(--ink-muted)]">适合临时密码或安全重置后的账号</span>
              </span>
              <input
                type="checkbox"
                checked={mustChange}
                onChange={(e) => setMustChange(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-subtle)]"
              />
            </label>
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/55 p-3">
            <h3 className="mb-2 text-sm font-semibold text-[var(--ink-primary)]">安全操作</h3>
            <Field label="重置为新密码">
              <input
                className={inputClass}
                type="password"
                placeholder="输入新密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={!password}
              loading={resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
              className="mt-3 w-full gap-2"
            >
              <KeyRound className="h-4 w-4" />
              重置密码并要求改密
            </Button>
          </section>
        </div>

        <footer className="flex gap-2 border-t border-[var(--border-subtle)] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="secondary" onClick={onClose} className="flex-1">取消</Button>
          <Button loading={updateMutation.isPending} onClick={() => updateMutation.mutate()} className="flex-1 gap-2">
            <Check className="h-4 w-4" />
            保存
          </Button>
        </footer>
      </aside>
    </div>,
    document.body
  );
}

function RolesPanel() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [permissionSearch, setPermissionSearch] = useState('');

  const rolesQuery = useQuery({
    queryKey: ['access-roles'],
    queryFn: async () => {
      const res = await accessService.listRoles();
      return res.code === 200 ? res.data : [];
    },
  });

  const permissionsQuery = useQuery({
    queryKey: ['access-permissions'],
    queryFn: async () => {
      const res = await accessService.listPermissions();
      return res.code === 200 ? res.data : [];
    },
  });

  const roles = rolesQuery.data ?? [];
  const permissions = permissionsQuery.data ?? [];
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0];

  useEffect(() => {
    if (!selectedRole) return;
    setSelectedRoleId(selectedRole.id);
    setPermissionCodes(selectedRole.permissions.map((p) => p.code));
  }, [selectedRole]);

  const updateMutation = useMutation({
    mutationFn: () => accessService.updateRolePermissions(selectedRole!.id, permissionCodes),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('角色权限已更新');
      queryClient.invalidateQueries({ queryKey: ['access-roles'] });
    },
    onError: (err: any) => toast.error(err?.message || '更新角色权限失败'),
  });

  const filteredPermissions = useMemo(() => {
    const keyword = permissionSearch.trim().toLowerCase();
    if (!keyword) return permissions;
    return permissions.filter((permission) =>
      [permission.name, permission.code, permission.module, permission.action, permission.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [permissionSearch, permissions]);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    filteredPermissions.forEach((permission) => {
      map.set(permission.module, [...(map.get(permission.module) ?? []), permission]);
    });
    return Array.from(map.entries());
  }, [filteredPermissions]);

  if (!selectedRole) {
    return <EmptyState text="暂无角色" />;
  }

  const selectedCount = permissionCodes.length;

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={panelClass}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">角色</h2>
            <p className="text-xs text-[var(--ink-muted)]">{roles.length} 个角色定义</p>
          </div>
          <ShieldCheck className="h-5 w-5 text-[var(--aurora-1)]" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedRoleId(role.id)}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition-colors',
                selectedRole.id === role.id
                  ? 'border-primary bg-primary/10 text-[var(--ink-primary)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)]'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{role.name}</div>
                <span className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--ink-muted)]">
                  {role.permissions.length}
                </span>
              </div>
              <div className="mt-1 truncate text-xs text-[var(--ink-muted)]">{role.code}</div>
            </button>
          ))}
        </div>
      </aside>

      <section className={panelClass}>
        <div className="mb-4 grid gap-3 border-b border-[var(--border-subtle)] pb-4 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{selectedRole.name}</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{selectedRole.description || selectedRole.code}</p>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              当前选择 {selectedCount} / {permissions.length} 项权限
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              className={cn(inputClass, 'pl-9')}
              value={permissionSearch}
              onChange={(e) => setPermissionSearch(e.target.value)}
              placeholder="搜索权限"
            />
          </div>
          <Button onClick={() => updateMutation.mutate()} loading={updateMutation.isPending} className="gap-2">
            <Check className="h-4 w-4" />
            保存权限
          </Button>
        </div>

        <div className="space-y-5">
          {grouped.map(([module, list]) => {
            const moduleCodes = list.map((permission) => permission.code);
            const checkedCount = moduleCodes.filter((code) => permissionCodes.includes(code)).length;
            const allChecked = checkedCount === moduleCodes.length;
            return (
              <section key={module} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/45 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--ink-primary)]">{module}</h3>
                    <p className="text-xs text-[var(--ink-muted)]">{checkedCount} / {moduleCodes.length} 已启用</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPermissionCodes((prev) => {
                        const set = new Set(prev);
                        if (allChecked) moduleCodes.forEach((code) => set.delete(code));
                        else moduleCodes.forEach((code) => set.add(code));
                        return Array.from(set);
                      });
                    }}
                    className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)]"
                  >
                    {allChecked ? '取消本组' : '启用本组'}
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                  {list.map((permission) => {
                    const checked = permissionCodes.includes(permission.code);
                    return (
                      <label
                        key={permission.code}
                        className={cn(
                          'flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                          checked
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-leaf)] hover:bg-[var(--bg-card-hover)]'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setPermissionCodes((prev) => e.target.checked
                              ? [...prev, permission.code]
                              : prev.filter((code) => code !== permission.code));
                          }}
                          className="mt-1 h-4 w-4"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[var(--ink-primary)]">{permission.name}</span>
                          <span className="mt-1 block truncate font-mono text-xs text-[var(--ink-muted)]">{permission.code}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {grouped.length === 0 && <EmptyState text="没有匹配的权限" />}
        </div>
      </section>
    </div>
  );
}

function TeamsPanel() {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState({ name: '', slug: '', description: '', ownerId: '', visibility: 'PRIVATE' as Team['visibility'] });
  const [teamEditForm, setTeamEditForm] = useState({ name: '', slug: '', description: '', ownerId: '', visibility: 'PRIVATE' as Team['visibility'] });
  const [memberForm, setMemberForm] = useState({ userId: '', memberRole: 'MEMBER' as TeamMember['memberRole'], status: 'ACTIVE' as TeamMember['status'] });

  const teamsQuery = useQuery({
    queryKey: ['access-teams'],
    queryFn: async () => {
      const res = await accessService.listTeams();
      return res.code === 200 ? res.data : [];
    },
  });

  const usersQuery = useQuery({
    queryKey: ['access-users', 'picker'],
    queryFn: listAllUsersForPicker,
  });

  const users = usersQuery.data ?? [];
  const userOptions = useMemo(() => makeUserOptions(users), [users]);
  const teams = teamsQuery.data ?? [];
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];

  useEffect(() => {
    if (selectedTeam && selectedTeamId == null) setSelectedTeamId(selectedTeam.id);
  }, [selectedTeam?.id, selectedTeamId]);

  useEffect(() => {
    if (!selectedTeam) return;
    setTeamEditForm({
      name: selectedTeam.name,
      slug: selectedTeam.slug,
      description: selectedTeam.description || '',
      ownerId: selectedTeam.ownerId ? String(selectedTeam.ownerId) : '',
      visibility: selectedTeam.visibility,
    });
  }, [selectedTeam]);

  const membersQuery = useQuery({
    queryKey: ['access-team-members', selectedTeam?.id],
    enabled: Boolean(selectedTeam?.id),
    queryFn: async () => {
      const res = await accessService.listTeamMembers(selectedTeam!.id);
      return res.code === 200 ? res.data : [];
    },
  });

  const createTeamMutation = useMutation({
    mutationFn: () => accessService.createTeam({
      name: teamForm.name,
      slug: teamForm.slug,
      description: teamForm.description || undefined,
      ownerId: parseOptionalNumber(teamForm.ownerId),
      visibility: teamForm.visibility,
    }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('团队已创建');
      setTeamForm({ name: '', slug: '', description: '', ownerId: '', visibility: 'PRIVATE' });
      setSelectedTeamId(res.data.id);
      queryClient.invalidateQueries({ queryKey: ['access-teams'] });
    },
    onError: (err: any) => toast.error(err?.message || '创建团队失败'),
  });

  const updateTeamMutation = useMutation({
    mutationFn: () => accessService.updateTeam(selectedTeam!.id, {
      name: teamEditForm.name,
      slug: teamEditForm.slug,
      description: teamEditForm.description || undefined,
      ownerId: parseOptionalNumber(teamEditForm.ownerId),
      visibility: teamEditForm.visibility,
    }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('团队资料已更新');
      queryClient.invalidateQueries({ queryKey: ['access-teams'] });
      queryClient.invalidateQueries({ queryKey: ['access-team-members', selectedTeam?.id] });
    },
    onError: (err: any) => toast.error(err?.message || '更新团队失败'),
  });

  const upsertMemberMutation = useMutation({
    mutationFn: () => accessService.upsertTeamMember(selectedTeam!.id, {
      userId: Number(memberForm.userId),
      memberRole: memberForm.memberRole,
      status: memberForm.status,
    }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('团队成员已更新');
      setMemberForm({ userId: '', memberRole: 'MEMBER', status: 'ACTIVE' });
      queryClient.invalidateQueries({ queryKey: ['access-team-members', selectedTeam?.id] });
      queryClient.invalidateQueries({ queryKey: ['access-teams'] });
    },
    onError: (err: any) => toast.error(err?.message || '更新团队成员失败'),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: number) => accessService.removeTeamMember(selectedTeam!.id, userId),
    onSuccess: () => {
      toast.success('成员已移除');
      queryClient.invalidateQueries({ queryKey: ['access-team-members', selectedTeam?.id] });
      queryClient.invalidateQueries({ queryKey: ['access-teams'] });
    },
    onError: (err: any) => toast.error(err?.message || '移除成员失败'),
  });

  const totalMembers = teams.reduce((sum, team) => sum + team.memberCount, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <MetricCard label="团队" value={teams.length} helper="协作空间" />
          <MetricCard label="成员关系" value={totalMembers} helper="累计成员" tone="success" />
        </div>

        <section className={panelClass}>
          <h2 className="mb-3 text-base font-semibold">新建团队</h2>
          <div className="space-y-3">
            <Field label="名称">
              <input className={inputClass} value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} />
            </Field>
            <Field label="Slug">
              <input className={inputClass} value={teamForm.slug} onChange={(e) => setTeamForm({ ...teamForm, slug: e.target.value })} />
            </Field>
            <Field label="所有者">
              <Select value={teamForm.ownerId} onValueChange={(ownerId) => setTeamForm({ ...teamForm, ownerId })} options={userOptions} disabled={usersQuery.isLoading} disabledHint="正在加载用户" />
            </Field>
            <Field label="可见性">
              <Select value={teamForm.visibility} onValueChange={(v) => setTeamForm({ ...teamForm, visibility: v as Team['visibility'] })} options={teamVisibilityOptions} />
            </Field>
            <Field label="描述">
              <input className={inputClass} value={teamForm.description} onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })} />
            </Field>
            <Button onClick={() => createTeamMutation.mutate()} loading={createTeamMutation.isPending} className="w-full gap-2">
              <Plus className="h-4 w-4" />
              创建团队
            </Button>
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition-colors',
                selectedTeam?.id === team.id
                  ? 'border-primary bg-primary/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-leaf)] hover:bg-[var(--bg-card-hover)]'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-semibold">{team.name}</span>
                <span className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--ink-muted)]">{team.memberCount} 人</span>
              </div>
              <div className="mt-1 truncate text-xs text-[var(--ink-muted)]">{team.slug} · {visibilityLabelMap.get(team.visibility) || team.visibility}</div>
            </button>
          ))}
        </section>
      </aside>

      <section className={panelClass}>
        {selectedTeam ? (
          <>
            <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold">{selectedTeam.name}</h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {selectedTeam.slug} · {visibilityLabelMap.get(selectedTeam.visibility) || selectedTeam.visibility}
                </p>
              </div>
              <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['access-team-members', selectedTeam.id] })} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                刷新成员
              </Button>
            </div>

            <div className="mb-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/45 p-3">
              <h3 className="mb-3 text-sm font-semibold">团队资料</h3>
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label="名称">
                  <input className={inputClass} value={teamEditForm.name} onChange={(e) => setTeamEditForm({ ...teamEditForm, name: e.target.value })} />
                </Field>
                <Field label="Slug">
                  <input className={inputClass} value={teamEditForm.slug} onChange={(e) => setTeamEditForm({ ...teamEditForm, slug: e.target.value })} />
                </Field>
                <Field label="所有者">
                  <Select value={teamEditForm.ownerId} onValueChange={(ownerId) => setTeamEditForm({ ...teamEditForm, ownerId })} options={userOptions} disabled={usersQuery.isLoading} disabledHint="正在加载用户" />
                </Field>
                <Field label="可见性">
                  <Select value={teamEditForm.visibility} onValueChange={(v) => setTeamEditForm({ ...teamEditForm, visibility: v as Team['visibility'] })} options={teamVisibilityOptions} />
                </Field>
                <Field label="描述">
                  <input className={inputClass} value={teamEditForm.description} onChange={(e) => setTeamEditForm({ ...teamEditForm, description: e.target.value })} />
                </Field>
                <div className="flex items-end">
                  <Button onClick={() => updateTeamMutation.mutate()} loading={updateTeamMutation.isPending} className="w-full gap-2">
                    <Check className="h-4 w-4" />
                    保存团队资料
                  </Button>
                </div>
              </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px_170px_auto]">
              <Select value={memberForm.userId} onValueChange={(userId) => setMemberForm({ ...memberForm, userId })} options={userOptions} placeholder="选择成员" disabled={usersQuery.isLoading} disabledHint="正在加载用户" />
              <Select value={memberForm.memberRole} onValueChange={(v) => setMemberForm({ ...memberForm, memberRole: v as TeamMember['memberRole'] })} options={memberRoleOptions} />
              <Select value={memberForm.status} onValueChange={(v) => setMemberForm({ ...memberForm, status: v as TeamMember['status'] })} options={memberStatusOptions} />
              <Button onClick={() => upsertMemberMutation.mutate()} disabled={!memberForm.userId} loading={upsertMemberMutation.isPending} className="gap-2">
                <UserPlus className="h-4 w-4" />
                添加/更新
              </Button>
            </div>

            <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)]">
              {(membersQuery.data ?? []).map((member) => (
                <div key={member.userId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{userDisplayName(member)}</div>
                    <div className="mt-1 truncate text-xs text-[var(--ink-muted)]">
                      #{member.userId} · {member.email}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <SmallPill>{memberRoleLabelMap.get(member.memberRole) || member.memberRole}</SmallPill>
                      <SmallPill>{memberStatusLabelMap.get(member.status) || member.status}</SmallPill>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeMemberMutation.mutate(member.userId)} className="gap-1 text-status-danger sm:self-center">
                    <Trash2 className="h-3.5 w-3.5" />
                    移除
                  </Button>
                </div>
              ))}
              {!membersQuery.isLoading && (membersQuery.data ?? []).length === 0 && <EmptyState text="暂无成员" />}
            </div>
          </>
        ) : (
          <EmptyState text="暂无团队" />
        )}
      </section>
    </div>
  );
}

function SharesPanel() {
  const queryClient = useQueryClient();
  const [resourceSearch, setResourceSearch] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<number[]>([]);
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [form, setForm] = useState({
    resourceType: 'POST' as SharedResourceType,
    resourceId: '',
    principalType: 'USER' as SharePrincipalType,
    principalId: '',
    permissionLevel: 'VIEW' as ContentPermissionLevel,
    expiresAt: '',
  });

  const sharesQuery = useQuery({
    queryKey: ['access-content-shares'],
    queryFn: async () => {
      const res = await accessService.listContentShares();
      return res.code === 200 ? res.data : [];
    },
  });

  const resourcesQuery = useQuery({
    queryKey: ['access-shareable-resources', form.resourceType, resourceSearch],
    queryFn: async () => {
      const res = await accessService.listShareableResources({
        resourceType: form.resourceType,
        search: resourceSearch.trim() || undefined,
        limit: shareResourceLoadLimit,
      });
      return res.code === 200 ? res.data : [];
    },
  });

  const postResourcesQuery = useQuery({
    queryKey: ['access-shareable-resources', 'POST', 'lookup'],
    queryFn: async () => {
      const res = await accessService.listShareableResources({ resourceType: 'POST', limit: shareResourceLoadLimit });
      return res.code === 200 ? res.data : [];
    },
  });

  const mediaResourcesQuery = useQuery({
    queryKey: ['access-shareable-resources', 'MEDIA_FILE', 'lookup'],
    queryFn: async () => {
      const res = await accessService.listShareableResources({ resourceType: 'MEDIA_FILE', limit: shareResourceLoadLimit });
      return res.code === 200 ? res.data : [];
    },
  });

  const folderResourcesQuery = useQuery({
    queryKey: ['access-shareable-resources', 'MEDIA_FOLDER', 'lookup'],
    queryFn: async () => {
      const res = await accessService.listShareableResources({ resourceType: 'MEDIA_FOLDER', limit: shareResourceLoadLimit });
      return res.code === 200 ? res.data : [];
    },
  });

  const usersQuery = useQuery({
    queryKey: ['access-users', 'share-picker'],
    queryFn: listAllUsersForPicker,
  });

  const teamsQuery = useQuery({
    queryKey: ['access-teams', 'share-picker'],
    queryFn: async () => {
      const res = await accessService.listTeams();
      return res.code === 200 ? res.data : [];
    },
  });

  const rolesQuery = useQuery({
    queryKey: ['access-roles', 'share-picker'],
    queryFn: async () => {
      const res = await accessService.listRoles();
      return res.code === 200 ? res.data : [];
    },
  });

  const users = usersQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const roles = rolesQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];
  const resourceLoadFailed = resourcesQuery.isError;
  const resourceOptions = useMemo<SelectOption[]>(() => resources.map(resourceOption), [resources]);
  const selectedResourceIdSet = useMemo(() => new Set(selectedResourceIds), [selectedResourceIds]);
  const selectedResourceCount = selectAllMatching ? resources.length : selectedResourceIds.length;

  const resourceLookup = useMemo(() => {
    const map = new Map<string, ShareableResource>();
    [
      ...(postResourcesQuery.data ?? []),
      ...(mediaResourcesQuery.data ?? []),
      ...(folderResourcesQuery.data ?? []),
      ...resources,
    ].forEach((resource) => {
      map.set(makeResourceKey(resource.resourceType, resource.id), resource);
    });
    return map;
  }, [folderResourcesQuery.data, mediaResourcesQuery.data, postResourcesQuery.data, resources]);

  const selectedResourceLabels = useMemo(() => {
    return selectedResourceIds.slice(0, 6).map((id) => {
      const resource = resourceLookup.get(makeResourceKey(form.resourceType, id));
      return resource?.title || `#${id}`;
    });
  }, [form.resourceType, resourceLookup, selectedResourceIds]);

  const principalOptions = useMemo<SelectOption[]>(() => {
    if (form.principalType === 'USER') return makeUserOptions(users).filter((item) => item.value !== '');
    if (form.principalType === 'TEAM') {
      return teams.map((team) => ({
        value: String(team.id),
        label: team.name,
        description: `${team.slug} · ${visibilityLabelMap.get(team.visibility) || team.visibility}`,
      }));
    }
    return roles.map((role) => ({
      value: String(role.id),
      label: role.name,
      description: `${role.code} · ${role.permissions.length} 项权限`,
    }));
  }, [form.principalType, roles, teams, users]);

  const addResource = (resourceId: string) => {
    const id = Number(resourceId);
    if (!Number.isFinite(id) || id <= 0) return;
    setSelectAllMatching(false);
    setSelectedResourceIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setForm({ ...form, resourceId });
  };

  const toggleResource = (resourceId: number, checked: boolean) => {
    setSelectAllMatching(false);
    setSelectedResourceIds((prev) => {
      if (checked) return prev.includes(resourceId) ? prev : [...prev, resourceId];
      return prev.filter((id) => id !== resourceId);
    });
    if (checked) {
      setForm({ ...form, resourceId: String(resourceId) });
    } else if (form.resourceId === String(resourceId)) {
      setForm({ ...form, resourceId: '' });
    }
  };

  const selectLoadedResources = () => {
    setSelectAllMatching(false);
    setSelectedResourceIds((prev) => {
      const next = new Set(prev);
      resources.forEach((resource) => next.add(resource.id));
      return Array.from(next);
    });
    setForm({ ...form, resourceId: resources[0] ? String(resources[0].id) : '' });
  };

  const selectEveryMatchingResource = () => {
    setSelectAllMatching(true);
    setSelectedResourceIds([]);
    setForm({ ...form, resourceId: '' });
  };

  const clearResourceSelection = () => {
    setSelectAllMatching(false);
    setSelectedResourceIds([]);
    setForm({ ...form, resourceId: '' });
  };

  const handleResourceTypeChange = (resourceType: SharedResourceType) => {
    setForm({ ...form, resourceType, resourceId: '' });
    setResourceSearch('');
    setSelectAllMatching(false);
    setSelectedResourceIds([]);
  };

  const principalName = (share: ContentShare) => {
    if (share.principalType === 'USER') {
      const user = users.find((item) => item.id === share.principalId);
      return user ? userDisplayName(user) : `用户 #${share.principalId}`;
    }
    if (share.principalType === 'TEAM') {
      const team = teams.find((item) => item.id === share.principalId);
      return team ? team.name : `团队 #${share.principalId}`;
    }
    const role = roles.find((item) => item.id === share.principalId);
    return role ? role.name : `角色 #${share.principalId}`;
  };

  const resourceName = (share: ContentShare) => {
    const resource = resourceLookup.get(makeResourceKey(share.resourceType, share.resourceId));
    return resource?.title || `${resourceTypeLabelMap.get(share.resourceType) || share.resourceType} #${share.resourceId}`;
  };

  const resourceMeta = (share: ContentShare) => {
    const resource = resourceLookup.get(makeResourceKey(share.resourceType, share.resourceId));
    if (!resource) return `#${share.resourceId}`;
    return [resourceTypeLabelMap.get(resource.resourceType), `#${resource.id}`, resource.status, resource.subtitle].filter(Boolean).join(' · ');
  };

  const createMutation = useMutation({
    mutationFn: () => accessService.createContentSharesBatch({
      resourceType: form.resourceType,
      resourceIds: selectAllMatching ? undefined : selectedResourceIds,
      resourceSearch: selectAllMatching ? resourceSearch.trim() || undefined : undefined,
      selectAllMatching,
      principalType: form.principalType,
      principalId: Number(form.principalId),
      permissionLevel: form.permissionLevel,
      expiresAt: form.expiresAt || undefined,
    }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success(`已保存 ${res.data.total} 项共享授权`);
      setSelectAllMatching(false);
      setSelectedResourceIds([]);
      setForm({ ...form, resourceId: '', principalId: '', expiresAt: '' });
      queryClient.invalidateQueries({ queryKey: ['access-content-shares'] });
      queryClient.invalidateQueries({ queryKey: ['access-shareable-resources'] });
    },
    onError: (err: any) => toast.error(err?.message || '保存共享授权失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => accessService.deleteContentShare(id),
    onSuccess: () => {
      toast.success('共享授权已删除');
      queryClient.invalidateQueries({ queryKey: ['access-content-shares'] });
    },
    onError: (err: any) => toast.error(err?.message || '删除共享授权失败'),
  });

  const shares = sharesQuery.data ?? [];
  const expiringCount = shares.filter((share) => share.expiresAt).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <MetricCard label="授权记录" value={shares.length} helper="当前共享授权" />
        <MetricCard label="含过期时间" value={expiringCount} helper="有时效控制的授权" tone="warn" />
        <MetricCard label="永久授权" value={shares.length - expiringCount} helper="未设置过期时间" tone="success" />
      </div>

      <section className={panelClass}>
        <div className="mb-4">
          <h2 className="text-base font-semibold">创建共享授权</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            选择真实文章、媒体或文件夹后再授权给用户、团队或角色。文章授权已接入登录态协作内容入口，媒体授权沉淀到统一策略表供媒体访问策略复用。
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-[160px_minmax(0,1fr)_minmax(0,1.35fr)]">
          <Field label="资源类型">
            <Select
              value={form.resourceType}
              onValueChange={(v) => handleResourceTypeChange(v as SharedResourceType)}
              options={resourceTypeOptions}
            />
          </Field>
          <Field label="搜索资源">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                className={cn(inputClass, 'pl-9')}
                value={resourceSearch}
                onChange={(e) => setResourceSearch(e.target.value)}
                placeholder="标题、slug、文件名或路径"
              />
            </div>
          </Field>
          <Field label="资源">
            <Select
              value={form.resourceId}
              onValueChange={addResource}
              options={resourceOptions}
              placeholder={resourcesQuery.isLoading ? '正在加载资源' : resourceLoadFailed ? '资源加载失败' : '选择后加入批量'}
              disabled={resourceOptions.length === 0}
              disabledHint={resourcesQuery.isLoading ? '正在加载资源' : resourceLoadFailed ? '资源加载失败' : '暂无可选资源'}
            />
            {resourceLoadFailed && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-status-danger/25 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
                <span>资源列表加载失败</span>
                <button
                  type="button"
                  onClick={() => resourcesQuery.refetch()}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-status-danger/30 px-2 font-semibold hover:bg-status-danger/10"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </button>
              </div>
            )}
          </Field>
        </div>
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-leaf)]">
          <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] p-3 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-[var(--ink-muted)]">
              {resourcesQuery.isLoading
                ? '正在加载资源'
                : `已加载 ${resources.length} 项，已选择 ${selectAllMatching ? '全部匹配' : `${selectedResourceIds.length} 项`}`}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectLoadedResources}
                disabled={resources.length === 0 || resourcesQuery.isLoading}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                全选当前结果
              </button>
              <button
                type="button"
                onClick={selectEveryMatchingResource}
                disabled={resourcesQuery.isLoading || resourceLoadFailed}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 text-xs font-semibold text-[var(--ink-primary)] hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Share2 className="h-3.5 w-3.5" />
                全选全部匹配
              </button>
              <button
                type="button"
                onClick={clearResourceSelection}
                disabled={!selectAllMatching && selectedResourceIds.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                清空
              </button>
            </div>
          </div>
          {selectAllMatching && (
            <div className="border-b border-[var(--border-subtle)] bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--aurora-1)]">
              提交时将授权当前资源类型和搜索条件下的全部匹配资源，不只限于已加载列表。
            </div>
          )}
          {!selectAllMatching && selectedResourceLabels.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
              {selectedResourceLabels.map((label, index) => (
                <SmallPill key={`${label}-${index}`}>{label}</SmallPill>
              ))}
              {selectedResourceIds.length > selectedResourceLabels.length && (
                <SmallPill>另 {selectedResourceIds.length - selectedResourceLabels.length} 项</SmallPill>
              )}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {resources.map((resource) => {
              const selected = selectAllMatching || selectedResourceIdSet.has(resource.id);
              return (
                <label
                  key={makeResourceKey(resource.resourceType, resource.id)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0',
                    selected && 'bg-[color-mix(in_oklch,var(--aurora-1)_8%,transparent)]'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={selectAllMatching}
                    onChange={(event) => toggleResource(resource.id, event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--aurora-1)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--ink-primary)]">{resource.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
                      {[`#${resource.id}`, resource.status, resource.subtitle].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              );
            })}
            {!resourcesQuery.isLoading && resources.length === 0 && !resourceLoadFailed && (
              <EmptyState text="暂无可选资源" />
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-[150px_minmax(0,1.1fr)_150px_minmax(0,1fr)_auto] xl:items-end">
          <Field label="授权对象">
            <Select
              value={form.principalType}
              onValueChange={(v) => setForm({ ...form, principalType: v as SharePrincipalType, principalId: '' })}
              options={principalTypeOptions}
            />
          </Field>
          <Field label="对象">
            <Select
              value={form.principalId}
              onValueChange={(principalId) => setForm({ ...form, principalId })}
              options={principalOptions}
              placeholder="选择授权对象"
              disabled={principalOptions.length === 0}
              disabledHint="暂无可选对象"
            />
          </Field>
          <Field label="权限">
            <Select value={form.permissionLevel} onValueChange={(v) => setForm({ ...form, permissionLevel: v as ContentPermissionLevel })} options={contentPermissionOptions} />
          </Field>
          <Field label="过期时间">
            <input className={inputClass} type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </Field>
          <Button onClick={() => createMutation.mutate()} disabled={!form.principalId || selectedResourceCount === 0} loading={createMutation.isPending} className="gap-2">
            <Share2 className="h-4 w-4" />
            {selectAllMatching ? '批量授权全部' : selectedResourceIds.length > 1 ? `批量授权 ${selectedResourceIds.length} 项` : '保存授权'}
          </Button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shares.map((share) => (
          <ShareItem
            key={share.id}
            share={share}
            resourceName={resourceName(share)}
            resourceMeta={resourceMeta(share)}
            principalName={principalName(share)}
            onDelete={() => deleteMutation.mutate(share.id)}
          />
        ))}
        {!sharesQuery.isLoading && shares.length === 0 && <EmptyState text="暂无共享授权" />}
      </section>
    </div>
  );
}

function ShareItem({
  share,
  resourceName,
  resourceMeta,
  principalName,
  onDelete,
}: {
  share: ContentShare;
  resourceName: string;
  resourceMeta: string;
  principalName: string;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-leaf)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{resourceName}</div>
          <div className="mt-1 truncate text-xs text-[var(--ink-muted)]">
            {resourceMeta}
          </div>
          <div className="mt-1 truncate text-xs text-[var(--ink-muted)]">
            授权给 {principalTypeLabelMap.get(share.principalType) || share.principalType} · {principalName}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onDelete} className="shrink-0 text-status-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <SmallPill>{contentPermissionLabelMap.get(share.permissionLevel) || share.permissionLevel}</SmallPill>
        <SmallPill>{share.expiresAt ? '限时' : '永久'}</SmallPill>
      </div>
      <div className="mt-3 text-xs text-[var(--ink-muted)]">
        {share.expiresAt ? (
          <>
            过期: <span className="tnum font-mono">{toDateTime(share.expiresAt)}</span>
          </>
        ) : '永不过期'}
      </div>
    </article>
  );
}

function RoleToggle({ value, onChange, compact = false }: { value: string[]; onChange: (next: string[]) => void; compact?: boolean }) {
  const current = value.length > 0 ? value : ['USER'];
  const toggle = (role: string) => {
    const exists = current.includes(role);
    const next = exists ? current.filter((item) => item !== role) : [...current, role];
    onChange(next.length > 0 ? next : ['USER']);
  };

  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'gap-1.5')}>
      {roleOptions.map((role) => {
        const selected = current.includes(role.value);
        return (
          <button
            key={role.value}
            type="button"
            onClick={() => toggle(role.value)}
            className={cn(
              'rounded-full border font-semibold transition-colors',
              compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              selected
                ? 'border-primary bg-primary text-white'
                : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)]'
            )}
          >
            {role.label}
          </button>
        );
      })}
    </div>
  );
}

function UserAvatar({ user }: { user: ManagedUser | TeamMember }) {
  const rawAvatar = 'avatar' in user ? user.avatar : undefined;
  const avatarSrc = rawAvatar ? getMediaUrl(rawAvatar) : '';
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarSrc]);

  const label = userDisplayName(user);

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[color-mix(in_oklch,var(--aurora-1)_22%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,var(--bg-primary))] text-[var(--aurora-1)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" title={label}>
      {avatarSrc && !failed ? (
        <img
          src={avatarSrc}
          alt={`${label}头像`}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <UserRound className="h-[18px] w-[18px]" />
      )}
    </span>
  );
}

function RoleBadges({ roles }: { roles: string[] }) {
  return (
    <div className="flex max-w-full flex-wrap gap-1.5">
      {roles.map((role) => (
        <SmallPill key={role} strong={role === 'ADMIN'}>{roleLabel(role)}</SmallPill>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold',
        status === 'ACTIVE' && 'border-status-success-border bg-status-success-light text-status-success',
        status === 'INACTIVE' && 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--ink-muted)]',
        status === 'BANNED' && 'border-status-danger-border bg-status-danger-light text-status-danger'
      )}
    >
      {statusLabelMap.get(status) || status}
    </span>
  );
}

function SmallPill({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        strong
          ? 'border-primary bg-primary text-white'
          : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--ink-secondary)]'
      )}
    >
      {children}
    </span>
  );
}

function MetricCard({ label, value, helper, tone = 'default' }: { label: string; value: number; helper: string; tone?: 'default' | 'success' | 'warn' }) {
  return (
    <div
      data-tone={tone}
      className={cn(
      'access-metric-card min-w-0 rounded-xl border p-2.5 sm:p-4',
      tone === 'default' && 'border-[var(--border-subtle)] bg-[var(--bg-leaf)]',
      tone === 'success' && 'border-status-success-border bg-status-success-light',
      tone === 'warn' && 'border-status-warning-border bg-status-warning-light'
    )}>
      <div className="truncate text-[11px] font-semibold text-[var(--ink-muted)] sm:text-xs">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tnum text-[var(--ink-primary)] sm:mt-2 sm:text-2xl">{value}</div>
      <div className="mt-1 hidden text-xs text-[var(--ink-muted)] sm:block">{helper}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-muted)]">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="col-span-full flex min-h-32 items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] px-4 text-center text-sm text-[var(--ink-muted)]">
      {text}
    </div>
  );
}
