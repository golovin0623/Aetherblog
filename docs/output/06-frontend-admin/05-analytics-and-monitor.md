# 05 · 数据分析 / 系统监控 / 活动记录 / 仪表盘

> **范围**:`pages/dashboard/DashboardPage.tsx`、`pages/dashboard/components/*`、`pages/MonitorPage.tsx`、`pages/analytics/AnalyticsPage.tsx`、`pages/activities/ActivitiesPage.tsx`、`services/{analyticsService,activityService,systemService}.ts`、`hooks/useSmartPolling.ts`、`lib/aiMetrics.ts`、`components/charts/*`。

---

## 1. 范围

四个数据 / 监控类页面与共享组件:

| 路径 | 入口 | 关注点 |
| --- | --- | --- |
| `/dashboard` | `pages/dashboard/DashboardPage.tsx` | 全景仪表盘 — 内容统计 + AI 看板 + 系统监控 |
| `/analytics` | `pages/analytics/AnalyticsPage.tsx` | AI 调用维度专题(更细的过滤 / 计费缺口) |
| `/monitor` | `pages/MonitorPage.tsx` | 系统监控独立页(监控卡 + 容器状态 + 日志 + JWT 轮换) |
| `/activities` | `pages/activities/ActivitiesPage.tsx` | 活动事件流(审计) |

共用 13 个 dashboard 子组件(`pages/dashboard/components/`),被 Dashboard / Analytics / Monitor 三页交叉复用。

---

## 2. 共用 dashboard 组件

`pages/dashboard/components/index.ts` 导出 13 个:

| 组件 | 数据源 | 复用页 |
| --- | --- | --- |
| `StatsCard` | (props) | Dashboard / Analytics |
| `VisitorChart` | analyticsService.getVisitorTrend | Dashboard |
| `TopPosts` | analyticsService(在 dashboard) | Dashboard |
| `DeviceChart` | dashboardData.deviceStats | Dashboard |
| `RecentActivity` | activityService.getRecentActivities | Dashboard |
| `SystemStatus` | systemService.getOverview(轮询) | Dashboard / Monitor |
| `SystemTrends` | systemService.getHistory | Dashboard / Monitor |
| `ContainerStatus` | systemService.getContainers(轮询) | Dashboard / Monitor |
| `RealtimeLogViewer` | systemService.getContainerLogs / getLogs | Dashboard / Monitor |
| `AiUsageTrendChart` | analyticsService.getAiDashboard.trend | Dashboard / Analytics |
| `AiModelDistributionChart` | analyticsService.getAiDashboard.modelDistribution | Dashboard / Analytics |
| `AiTaskDistributionChart` | analyticsService.getAiDashboard.taskDistribution | Analytics |
| `AiUsageRecordsTable` | analyticsService.getAiDashboard.records | Dashboard / Analytics |

---

## 3. 仪表盘(`DashboardPage.tsx`,708 行)

### 3.1 视图组成(自上而下)

```
┌ Header(标题 + 上次更新时间)
├ 8 张 StatsCard:文章 / 访客 / 浏览量 / 评论 / 分类 / 总字数 / AI Tokens / AI 费用
├ AI 调用统计区(健康徽章 + 重试 + 7/30/90 天切换 + 5 张 AI StatsCard)
│   ├─ AiUsageTrendChart(趋势)+ AiModelDistributionChart(模型饼图)
│   └─ AiUsageRecordsTable(分页明细 + 4 个过滤器)
├ TopPosts + RecentActivity 双栏
├ VisitorChart(7/30 天)+ DeviceChart 三栏
└ 系统监控区(SystemTrends + SystemStatus + RealtimeLogViewer + ContainerStatus 2x2)
```

### 3.2 状态拓扑

```
loading / data: DashboardData | null      // 第一次拉的结果
timeRange: '7d' | '30d'                   // VisitorChart 上 segmented
trendLoading / visitorTrend               // 时间范围切换时的局部加载

aiLoading / aiData: AiDashboardData       // AI 仪表盘结果
aiDays: 7 | 30 | 90
aiPage / aiPageSize / aiTaskType / aiModelId / aiKeyword / aiSuccessFilter   // 表格过滤
aiStatus: 'healthy' | 'degraded'          // 健康标
aiIssueMessage / aiIssueCategory          // 错误诊断
aiLastSuccessAt: Date | null              // 最近成功时间
aiReloadTick                              // 手动重试 nonce

selectedContainer: { id, name }            // 容器日志选择
```

### 3.3 数据流

```
mount
  ├─ analyticsService.getDashboard()                            → DashboardData
  │    失败回退到 mockData(防演示环境白屏)
  └─ effect (timeRange, mockData, fetchTrendData)
      ├─ analyticsService.getVisitorTrend(7|30)                 → VisitorTrend[]
      └─ 失败 → fallback fake 数据

aiDays / aiPage / aiPageSize / aiTaskType / aiModelId / aiSuccess / aiKeyword / aiReloadTick 任意变化:
  └─ analyticsService.getAiDashboard({ days, pageNum, pageSize, taskType, modelId, success, keyword })
       → 200: setAiData + setAiStatus('healthy') + setAiLastSuccessAt
       → 非 200: setAiStatus('degraded') + setAiIssueMessage + setAiIssueCategory
       → 异常: 同上,extractApiIssue 兜底解析
```

### 3.4 调用接口

| Endpoint | 用途 |
| --- | --- |
| `GET /v1/admin/stats/dashboard` | DashboardData(stats / topPosts / visitorTrend / archiveStats / deviceStats / trends) |
| `GET /v1/admin/stats/visitor-trend?days=` | 单独的访客趋势(timeRange 切换时拉) |
| `GET /v1/admin/stats/ai-dashboard?days=&pageNum=&pageSize=&taskType=&modelId=&success=&keyword=` | AI 看板复合数据 |

### 3.5 Mock fallback

`DashboardPage.tsx:100-135` 定义 `mockData`(假数据),`fetchData` catch 时 `setData(mockData)` + toast.error("加载仪表盘数据失败,显示演示数据")。每个 fetch 都有 fallback,**避免演示环境白屏**。但**没有像 CommentsPage 那样静默成功** — 这里仍 toast.error 提醒用户。

### 3.6 AI 健康标 + 降级提示

```tsx
{aiStatus === 'degraded' && (
  <div className="rounded-lg border border-status-warning-border bg-status-warning-light px-3 py-2 text-sm text-status-warning">
    AI 看板已进入降级模式:{aiIssueMessage || '请求失败'}。
    当前展示最近一次成功数据,可点击"重试"恢复。
  </div>
)}
```

`aiReloadTick` 是手动 retry 的 nonce — 加 1 触发 effect 重跑。

### 3.7 设计系统应用点

- `StatsCard` 的色彩通过 `colorStyles` 映射到 `aurora-1..4` + 状态色;早期 primary/indigo/purple 三份同义被统一折叠到 aurora 阶梯(`StatsCard.tsx:54-64` 注释)
- 图表区域大量 `recharts`,样式通过 `var(--ink-*)` / `var(--aurora-*)` 注入
- 系统监控区的 `SystemTrends` 内部 `--ink-secondary` 背景 + recharts area chart
- `RecentActivity` 的事件类别配色是个完整的 categoryConfig(post / comment / user / system / friend / media / ai),与 ActivitiesPage 共享配色表

### 3.8 已知限制

- `DashboardPage` 不用 React Query;3 个独立 useEffect + setState
- AI dashboard 失败时只在 banner 显示,**不会主动重试** — 必须手动点
- `mockData` 在 prod build 里仍存在,体积无谓增加
- 容器选择 / 日志查询 状态在 `selectedContainer` 中,跨页面切换不持久(切到 Monitor 页面会丢)

---

## 4. 系统监控页(`MonitorPage.tsx`,59 行)

```tsx
export default function MonitorPage() {
  const [selectedContainer, setSelectedContainer] = useState({ id: '', name: '' });
  return (
    <div className="space-y-6">
      <div>
        <h1>系统监控</h1>
        <p>实时监控系统运行状态与资源趋势</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SystemTrends className="h-[500px]" />          // 2/3
        <SystemStatus refreshInterval={30} h-[500px] />  // 1/3
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <RealtimeLogViewer ... className="h-[500px]" />  // 2/3
        <ContainerStatus refreshInterval={30} ... />     // 1/3
      </div>
      <JwtRotationCard />
    </div>
  );
}
```

**几乎是组合**:把 4 个 dashboard 子组件 + 1 个安全卡片堆起来。`refreshInterval={30}` 是默认 30s 轮询;Dashboard 的 SystemStatus 是 `{5}`(更密集),因为 Dashboard 第一屏要"实时感"。

`JwtRotationCard`(`components/security/JwtRotationCard.tsx`)的具体行为见 README §6.5。

---

## 5. 数据分析页(`AnalyticsPage.tsx`)

### 5.1 关注点

只看 AI 调用,不掺其他统计。比 Dashboard 的 AI 区做得更深:

- 5 张 AI StatsCard
- AiUsageTrendChart(2/3) + AiModelDistributionChart 或 AiTaskDistributionChart
- AiUsageRecordsTable(支持 4 个过滤器 + 分页)
- AiPricingGap 表格(`pricingGaps`),显示哪些模型缺计费规则
- "归档历史" 按钮 → `analyticsService.archiveAiCosts(query)`(`/v1/admin/stats/ai-cost-archive` POST)

### 5.2 状态/数据流

```
days / page / pageSize / taskType / modelId / successFilter / keyword 变化:
  └─ Promise.all([
       analyticsService.getAiDashboard(query),
       analyticsService.getAiPricingGaps(query),
     ])
     → 200: setData / setPricingGaps
     → 非 200: setData(EMPTY_DATA) / setPricingGaps([])
```

`refreshNonce` 让"归档后强制刷新"也走同一个 effect 通道,`React 把 setPage(1) + setRefreshNonce(...)` 批成一次渲染,避免重复请求(`AnalyticsPage.tsx:66-69` 的注释)。

### 5.3 接口

| Endpoint | 用途 |
| --- | --- |
| `GET /v1/admin/stats/ai-dashboard` | 同 Dashboard |
| `GET /v1/admin/stats/ai-pricing-gaps` | 缺失计费规则的 model 列表 |
| `POST /v1/admin/stats/ai-cost-archive` | 触发归档(把 realtime 价格固化为 archived) |

---

## 6. 活动记录(`ActivitiesPage.tsx`)

### 6.1 视图

- 顶部:筛选区(category 切换 + status 切换 + 搜索框 + 日期范围 + eventType 二级 dropdown)
- 主区:卡片列表(每条事件:类别图标 + 标题 + 描述 + 用户 + IP + 时间相对显示)
- 下方:分页

### 6.2 配置表

`ActivitiesPage.tsx:37-46`:

```ts
categoryConfig = {
  post / comment / user / system / friend / media / ai / security
}
```

每个类别有 icon + 三色 token(bgColor / borderColor / textColor)。

`statusConfig`(`:50-55`):INFO / SUCCESS / WARNING / ERROR(对应 `text-status-*` legacy)。

`eventTypeOptions`(`:70-100+`):每个 category 下的细分事件枚举,与后端 handler 写入的 EventType **严格对齐**(注释明说"新增请同步追加")。

### 6.3 数据流

```
filters 变化(useDebounce 关键词)→ activityService.getActivities({ category, eventType, status, search, startTime, endTime, pageNum, pageSize })
  → R<PageResult<ActivityEvent>>
```

URL `?eventType=&category=...` 通过 `useSearchParams` 同步,支持深链(从 Monitor 页面跳"安全事件" → Activities `?category=security`)。

### 6.4 接口

| Endpoint | 用途 |
| --- | --- |
| `GET /v1/admin/activities` | 列表 |
| `GET /v1/admin/activities/recent?limit=10` | 最近事件(Dashboard RecentActivity 用) |
| `GET /v1/admin/activities/user/{id}` | 指定用户事件 |

### 6.5 设计系统应用点

- categoryConfig / statusConfig 大量用 `bg-status-*-light` / `text-status-*` legacy
- 时间相对显示走 `formatDistanceToNow(parseISO(...), { locale: zhCN })`(date-fns)

---

## 7. 系统监控子组件深度

### 7.1 `SystemTrends`(`pages/dashboard/components/SystemTrends.tsx`)

- 历史趋势图(CPU / Memory / Disk / Network 四区)
- 时间范围:30m / 1h / 3h / 12h / 24h / 3d / 7d / 30d
- 刷新频率:5s / 10s / 30s / 1m / 5m
- `mergeHistoryData`:把 history.cpu/memory/disk 合并成单个时间线,fallback 0 if missing
- 用 `recharts AreaChart` 渲染
- 删除按钮 → `systemService.cleanupHistory()`

### 7.2 `SystemStatus`(`pages/dashboard/components/SystemStatus.tsx`)

- 4 张进度条:CPU / Memory / Disk / Network
- 颜色根据值变(`>90% danger / >75% warning / 默认 primary`)
- 服务健康列表:PostgreSQL / Redis / ES / ai-service 等
- 用 `useSmartPolling` 实现可见时轮询(隐藏 tab 时停止)

### 7.3 `ContainerStatus`(`pages/dashboard/components/ContainerStatus.tsx`)

- Docker 容器列表,显示 cpu% / mem%
- 点击行 → 设置 `selectedContainer` → RealtimeLogViewer 切换日志源

### 7.4 `RealtimeLogViewer`(`pages/dashboard/components/RealtimeLogViewer.tsx`)

- 复杂状态机(useReducer):`idle / loading / healthy / no_data / error / paused`
- 全屏 / 嵌入双模式
- 暂停 / 重连 / 清屏 / 下载日志(`systemService.getLogDownloadUrl`)
- 关键词搜索 / 级别筛选(ALL / DEBUG / INFO / WARN / ERROR)
- 运行时调整后端 / ai-service 日志级别(`systemService.getLogLevel` / `setLogLevel`)
- 容器日志:`systemService.getContainerLogs(id)` 简单 polling(没接 SSE)

### 7.5 `useSmartPolling`(`hooks/useSmartPolling.ts`,本文未读但行为可推断)

文档化的接口:tab 不可见时停止轮询,visibilitychange 重启;减少后台耗电。

---

## 8. 调用 server-go 接口汇总(本切片)

`services/systemService.ts`(440 行)— 接口最多的 service:

```
/v1/admin/system/metrics      实时 CPU/MEM/DISK/网络
/v1/admin/system/storage      存储明细(uploads / DB / logs / redis)
/v1/admin/system/health       服务健康
/v1/admin/system/overview     一次拿全部(metrics+storage+services)
/v1/admin/system/containers   Docker 容器列表
/v1/admin/system/history?minutes=&maxPoints=  历史趋势
/v1/admin/system/history/stats  历史统计(数据点数 / 保留期)
DELETE /v1/admin/system/history  清空历史
/v1/admin/system/alerts       活跃告警
/v1/admin/system/config       监控配置(threshold / retention)
/v1/admin/system/containers/{id}/logs  容器日志
/v1/admin/system/logs?level=&lines=&keyword=&cursor=  应用日志
/v1/admin/system/logs/files   可用日志文件列表
/v1/admin/system/logs/download?level=  下载链接(只生成 URL,不实际请求)
/v1/admin/system/log-level    GET/PUT 运行时日志级别
```

`services/analyticsService.ts`(类实例):
```
GET /v1/admin/stats/dashboard
GET /v1/admin/stats/top-posts?limit=
GET /v1/admin/stats/visitor-trend?days=
GET /v1/admin/stats/archives
GET /v1/admin/stats/ai-dashboard?...
GET /v1/admin/stats/ai-pricing-gaps?...
POST /v1/admin/stats/ai-cost-archive
```

`services/activityService.ts`(类实例):
```
GET /v1/admin/activities
GET /v1/admin/activities/recent?limit=
GET /v1/admin/activities/user/{id}
```

---

## 9. 设计系统应用点(汇总)

- 监控页 / 仪表盘大量 `bg-status-*-light` / `text-status-*` 系列 legacy 状态色
- StatsCard 已用 `aurora-1..4` 渐变背景(Codex)
- 进度条颜色 fallback 走 legacy `bg-primary`(在 admin 是近黑)
- `RecentActivity` / `ActivitiesPage` 的 categoryConfig 共享(`bg-status-info-light` 等),建议抽公共 util 表
- 几个图表的 axis / tick / tooltip 样式仍用 `var(--text-muted)` 等老 token,token 翻转时仍能跑

---

## 10. 已知限制 / 待改进

1. ⚠ **轮询数量众多**:Dashboard mount 后会同时跑 SystemStatus(5s) + SystemTrends(60s)+ ContainerStatus(30s)+ RealtimeLogViewer(continuous)+ AI dashboard(useEffect 触发)。CPU 不大但网络请求频繁。
2. ⚠ **`mockData` 是技术债**:`DashboardPage.tsx:100-135` 定义了 100+ 行假数据,prod 构建仍然带上。可以放进单独 `__fixtures` 文件,或仅在 `import.meta.env.DEV` 引入。
3. ⚠ **`pages/activities/ActivitiesPage.tsx` 的 eventTypeOptions 是硬编码**:新增后端事件类型 → 必须前端跟着改。后端可以提供 `/v1/admin/activities/event-types` 端点动态拉。
4. ⚠ **AI 仪表盘错误未持久化**:刷新页面后 `aiLastSuccessAt = null`,用户每次都看到"尚无最近成功"。可以把 `lastSuccessAt` 存 localStorage。
5. ⚠ **Dashboard 与 Analytics 的状态分别维护**:同一组 AI 过滤(taskType / modelId / successFilter / keyword)在两页独立 state。可考虑共享(URL params / global store)。
6. ⚠ **`RealtimeLogViewer` 的 `useReducer` 状态机**(`reduceLogViewState`)有 11 种 action + 8 种 lifecycle,值得抽单独 hook 或加测试。
7. ⚠ **轮询 hook `useSmartPolling`**:visibility 检测 + interval,但没暴露"立即重新拉"的 trigger;现在依赖 component 内的 nonce(`aiReloadTick` 等)模拟。
