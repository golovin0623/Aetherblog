import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Select, type SelectOption } from '@aetherblog/ui';
import { cn } from '@/lib/utils';
import { accessService } from '@/services/accessService';
import type {
  ContentPermissionLevel,
  ContentShare,
  ManagedUser,
  Role,
  SharePrincipalType,
  SharedResourceType,
  Team,
  TeamMember,
  UserStatus,
} from '@aetherblog/types';

type TabKey = 'users' | 'roles' | 'teams' | 'shares';

const tabs: Array<{ key: TabKey; label: string; icon: typeof Users }> = [
  { key: 'users', label: '用户', icon: Users },
  { key: 'roles', label: '角色权限', icon: ShieldCheck },
  { key: 'teams', label: '团队', icon: UserPlus },
  { key: 'shares', label: '内容共享', icon: Share2 },
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
  { value: 'POST', label: '文章' },
  { value: 'MEDIA_FILE', label: '媒体文件' },
  { value: 'MEDIA_FOLDER', label: '媒体文件夹' },
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

const inputClass = cn(
  'h-10 w-full rounded-lg border border-[color-mix(in_oklch,var(--ink-primary)_10%,transparent)]',
  'bg-[var(--bg-leaf)] px-3 text-sm text-[var(--ink-primary)]',
  'placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[color-mix(in_oklch,var(--aurora-1)_45%,transparent)]'
);

const panelClass = 'surface-leaf surface-admin-panel border border-[color-mix(in_oklch,var(--ink-primary)_8%,transparent)] rounded-lg p-4';

export default function AccessControlPage() {
  const [tab, setTab] = useState<TabKey>('users');

  return (
    <div className="min-h-full bg-[var(--bg-primary)] text-[var(--ink-primary)]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--aurora-1)_25%,transparent)] bg-[color-mix(in_oklch,var(--aurora-1)_10%,transparent)] px-3 py-1 text-xs font-medium text-[var(--aurora-1)]">
              <LockKeyhole className="h-3.5 w-3.5" />
              RBAC / Teams / Sharing
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-[var(--ink-primary)]">身份与共享</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-secondary)]">
              维护用户、角色权限、团队成员关系与跨资源共享授权。
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-leaf)] p-1">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--ink-primary)]'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_auto]">
        <div className="relative">
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
        <Button onClick={() => setShowCreate((v) => !v)} className="gap-2">
          <Plus className="h-4 w-4" />
          新建用户
        </Button>
      </div>

      {showCreate && (
        <div className={panelClass}>
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
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_180px_180px_auto] lg:items-end">
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

      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="bg-[var(--bg-leaf)] text-left text-xs uppercase text-[var(--ink-muted)]">
            <tr>
              <th className="w-[22%] px-4 py-3">用户</th>
              <th className="w-[20%] px-4 py-3">角色</th>
              <th className="w-[14%] px-4 py-3">状态</th>
              <th className="w-[18%] px-4 py-3">登录</th>
              <th className="w-[26%] px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-primary)]">
            {users.map((user) => <UserRow key={user.id} user={user} />)}
            {!usersQuery.isLoading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--ink-muted)]">暂无用户</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({ user }: { user: ManagedUser }) {
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<string[]>(user.roles?.length ? user.roles : [user.role || 'USER']);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [mustChange, setMustChange] = useState(user.mustChangePassword);
  const [password, setPassword] = useState('');

  useEffect(() => {
    setRoles(user.roles?.length ? user.roles : [user.role || 'USER']);
    setStatus(user.status);
    setMustChange(user.mustChangePassword);
  }, [user]);

  const updateMutation = useMutation({
    mutationFn: () => accessService.updateUser(user.id, { status, roleCodes: roles, mustChangePassword: mustChange }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('用户已更新');
      queryClient.invalidateQueries({ queryKey: ['access-users'] });
    },
    onError: (err: any) => toast.error(err?.message || '更新用户失败'),
  });

  const resetMutation = useMutation({
    mutationFn: () => accessService.resetPassword(user.id, { password, mustChangePassword: true }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('密码已重置');
      setPassword('');
    },
    onError: (err: any) => toast.error(err?.message || '重置密码失败'),
  });

  return (
    <tr className="align-top hover:bg-[var(--bg-card-hover)]">
      <td className="px-4 py-4">
        <div className="font-medium text-[var(--ink-primary)]">{user.nickname || user.username}</div>
        <div className="mt-1 truncate text-xs text-[var(--ink-muted)]">{user.username} · {user.email}</div>
      </td>
      <td className="px-4 py-4">
        <RoleToggle value={roles} onChange={setRoles} compact />
      </td>
      <td className="px-4 py-4">
        <Select value={status} onValueChange={(v) => setStatus(v as UserStatus)} options={statusOptions} size="sm" />
        <label className="mt-2 flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
          强制改密
        </label>
      </td>
      <td className="px-4 py-4 text-xs text-[var(--ink-muted)]">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '尚未登录'}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" loading={updateMutation.isPending} onClick={() => updateMutation.mutate()} className="gap-1">
            <Check className="h-3.5 w-3.5" />
            更新
          </Button>
          <input
            className={cn(inputClass, 'h-9 w-40')}
            type="password"
            placeholder="新密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button size="sm" variant="ghost" disabled={!password} loading={resetMutation.isPending} onClick={() => resetMutation.mutate()} className="gap-1">
            <KeyRound className="h-3.5 w-3.5" />
            重置
          </Button>
        </div>
      </td>
    </tr>
  );
}

function RolesPanel() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);

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

  const grouped = useMemo(() => {
    const map = new Map<string, typeof permissions>();
    permissions.forEach((permission) => {
      map.set(permission.module, [...(map.get(permission.module) ?? []), permission]);
    });
    return Array.from(map.entries());
  }, [permissions]);

  if (!selectedRole) {
    return <EmptyState text="暂无角色" />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            onClick={() => setSelectedRoleId(role.id)}
            className={cn(
              'w-full rounded-lg border px-4 py-3 text-left transition-colors',
              selectedRole.id === role.id
                ? 'border-primary bg-primary/10 text-[var(--ink-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-leaf)] text-[var(--ink-secondary)] hover:bg-[var(--bg-card-hover)]'
            )}
          >
            <div className="font-medium">{role.name}</div>
            <div className="mt-1 text-xs text-[var(--ink-muted)]">{role.code} · {role.permissions.length} 项权限</div>
          </button>
        ))}
      </div>

      <div className={panelClass}>
        <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{selectedRole.name}</h2>
            <p className="text-sm text-[var(--ink-muted)]">{selectedRole.description || selectedRole.code}</p>
          </div>
          <Button onClick={() => updateMutation.mutate()} loading={updateMutation.isPending} className="gap-2">
            <Check className="h-4 w-4" />
            保存权限
          </Button>
        </div>

        <div className="space-y-5">
          {grouped.map(([module, list]) => (
            <section key={module}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--ink-muted)]">{module}</h3>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {list.map((permission) => {
                  const checked = permissionCodes.includes(permission.code);
                  return (
                    <label
                      key={permission.code}
                      className={cn(
                        'flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                        checked
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:bg-[var(--bg-card-hover)]'
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
                      <span>
                        <span className="block text-sm font-medium text-[var(--ink-primary)]">{permission.name}</span>
                        <span className="mt-1 block font-mono text-xs text-[var(--ink-muted)]">{permission.code}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamsPanel() {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamForm, setTeamForm] = useState({ name: '', slug: '', description: '', ownerId: '', visibility: 'PRIVATE' as Team['visibility'] });
  const [memberForm, setMemberForm] = useState({ userId: '', memberRole: 'MEMBER' as TeamMember['memberRole'], status: 'ACTIVE' as TeamMember['status'] });

  const teamsQuery = useQuery({
    queryKey: ['access-teams'],
    queryFn: async () => {
      const res = await accessService.listTeams();
      return res.code === 200 ? res.data : [];
    },
  });
  const teams = teamsQuery.data ?? [];
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];

  useEffect(() => {
    if (selectedTeam && selectedTeamId == null) setSelectedTeamId(selectedTeam.id);
  }, [selectedTeam?.id, selectedTeamId]);

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
      ownerId: teamForm.ownerId ? Number(teamForm.ownerId) : undefined,
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

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className={panelClass}>
          <h2 className="mb-3 text-lg font-semibold">新建团队</h2>
          <div className="space-y-3">
            <Field label="名称">
              <input className={inputClass} value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} />
            </Field>
            <Field label="Slug">
              <input className={inputClass} value={teamForm.slug} onChange={(e) => setTeamForm({ ...teamForm, slug: e.target.value })} />
            </Field>
            <Field label="Owner ID">
              <input className={inputClass} type="number" value={teamForm.ownerId} onChange={(e) => setTeamForm({ ...teamForm, ownerId: e.target.value })} />
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
        </div>

        <div className="space-y-2">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={cn(
                'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                selectedTeam?.id === team.id
                  ? 'border-primary bg-primary/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-leaf)] hover:bg-[var(--bg-card-hover)]'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{team.name}</span>
                <span className="text-xs text-[var(--ink-muted)]">{team.memberCount} 人</span>
              </div>
              <div className="mt-1 text-xs text-[var(--ink-muted)]">{team.slug} · {team.visibility}</div>
            </button>
          ))}
        </div>
      </div>

      <div className={panelClass}>
        {selectedTeam ? (
          <>
            <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selectedTeam.name}</h2>
                <p className="text-sm text-[var(--ink-muted)]">Owner: {selectedTeam.ownerId ?? '未设置'} · {selectedTeam.visibility}</p>
              </div>
              <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['access-team-members', selectedTeam.id] })} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                刷新
              </Button>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_180px_180px_auto]">
              <input className={inputClass} type="number" placeholder="用户 ID" value={memberForm.userId} onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })} />
              <Select value={memberForm.memberRole} onValueChange={(v) => setMemberForm({ ...memberForm, memberRole: v as TeamMember['memberRole'] })} options={memberRoleOptions} />
              <Select value={memberForm.status} onValueChange={(v) => setMemberForm({ ...memberForm, status: v as TeamMember['status'] })} options={memberStatusOptions} />
              <Button onClick={() => upsertMemberMutation.mutate()} disabled={!memberForm.userId} loading={upsertMemberMutation.isPending} className="gap-2">
                <UserPlus className="h-4 w-4" />
                添加/更新
              </Button>
            </div>

            <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
              {(membersQuery.data ?? []).map((member) => (
                <div key={member.userId} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <div className="font-medium">{member.nickname || member.username}</div>
                    <div className="text-xs text-[var(--ink-muted)]">#{member.userId} · {member.email} · {member.memberRole} · {member.status}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeMemberMutation.mutate(member.userId)} className="gap-1 text-status-danger">
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
      </div>
    </div>
  );
}

function SharesPanel() {
  const queryClient = useQueryClient();
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

  const createMutation = useMutation({
    mutationFn: () => accessService.createContentShare({
      resourceType: form.resourceType,
      resourceId: Number(form.resourceId),
      principalType: form.principalType,
      principalId: Number(form.principalId),
      permissionLevel: form.permissionLevel,
      expiresAt: form.expiresAt || undefined,
    }),
    onSuccess: (res) => {
      if (res.code !== 200) throw new Error(res.message);
      toast.success('共享授权已保存');
      setForm({ ...form, resourceId: '', principalId: '', expiresAt: '' });
      queryClient.invalidateQueries({ queryKey: ['access-content-shares'] });
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

  return (
    <div className="space-y-4">
      <div className={panelClass}>
        <div className="grid gap-3 lg:grid-cols-[170px_1fr_170px_1fr_170px_1fr_auto] lg:items-end">
          <Field label="资源类型">
            <Select value={form.resourceType} onValueChange={(v) => setForm({ ...form, resourceType: v as SharedResourceType })} options={resourceTypeOptions} />
          </Field>
          <Field label="资源 ID">
            <input className={inputClass} type="number" value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })} />
          </Field>
          <Field label="授权对象">
            <Select value={form.principalType} onValueChange={(v) => setForm({ ...form, principalType: v as SharePrincipalType })} options={principalTypeOptions} />
          </Field>
          <Field label="对象 ID">
            <input className={inputClass} type="number" value={form.principalId} onChange={(e) => setForm({ ...form, principalId: e.target.value })} />
          </Field>
          <Field label="权限">
            <Select value={form.permissionLevel} onValueChange={(v) => setForm({ ...form, permissionLevel: v as ContentPermissionLevel })} options={contentPermissionOptions} />
          </Field>
          <Field label="过期时间">
            <input className={inputClass} type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </Field>
          <Button onClick={() => createMutation.mutate()} disabled={!form.resourceId || !form.principalId} loading={createMutation.isPending} className="gap-2">
            <Share2 className="h-4 w-4" />
            保存
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(sharesQuery.data ?? []).map((share) => (
          <ShareItem key={share.id} share={share} onDelete={() => deleteMutation.mutate(share.id)} />
        ))}
        {!sharesQuery.isLoading && (sharesQuery.data ?? []).length === 0 && <EmptyState text="暂无共享授权" />}
      </div>
    </div>
  );
}

function ShareItem({ share, onDelete }: { share: ContentShare; onDelete: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-leaf)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{share.resourceType} #{share.resourceId}</div>
          <div className="mt-1 text-xs text-[var(--ink-muted)]">
            {share.principalType} #{share.principalId} · {share.permissionLevel}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onDelete} className="text-status-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-3 text-xs text-[var(--ink-muted)]">
        {share.expiresAt ? `过期: ${new Date(share.expiresAt).toLocaleString('zh-CN')}` : '永不过期'}
      </div>
    </div>
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
              'rounded-full border font-medium transition-colors',
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--ink-muted)]">{label}</span>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="col-span-full flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] text-sm text-[var(--ink-muted)]">
      {text}
    </div>
  );
}
