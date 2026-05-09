# 05 · 系统监控

## 1. 责任范围

模块四的「运维观测」层,服务于 admin 后台的「系统监控」面板,提供:

- **实时系统指标** —— CPU / Memory / Disk / Network / Go runtime,平台特化采集(macOS top + sysctl + vm_stat,Linux /proc/stat + /proc/meminfo + /proc/net/dev)。
- **历史指标** —— 每 30s 一个快照,内存里保留 24h(~2880 条),支持 GET 时降采样到任意 maxPoints。
- **容器监控** —— 通过 Docker Engine API(unix socket 或 HTTP 代理)拉取 aetherblog-* 容器 + 配置里声明的外部依赖(Redis/Postgres)的 CPU/内存/状态,3s cache + singleflight。
- **日志查看** —— 读 `backend.log` / `ai-service.log`,支持 ALL 模式聚合按时间排序,JSON 格式日志按 level 字段过滤。
- **健康检查** —— PostgreSQL / Redis / AI Service 三件套连通性 + 延迟。
- **告警** —— CPU/Mem/Disk 连续 5 次超阈值触发 warning/critical,5 分钟内同指标去重。

不包括 Prometheus / Grafana 集成,不写日志到外部 SIEM。

## 2. 关键代码入口

### Handler

| file:line | 端点 | 描述 |
| --- | --- | --- |
| `apps/server-go/internal/handler/system_monitor_handler.go:65-81` | `MountAdmin` | 注册 15 个端点到 `/v1/admin/system` |
| `system_monitor_handler.go:85-88` | `GET /metrics` | 当前指标(CPU/Mem/Disk/Network) |
| `system_monitor_handler.go:92-95` | `GET /storage` | 上传 / 日志 / DB / Redis 占用明细 |
| `system_monitor_handler.go:99-102` | `GET /health` | DB / Redis / AI 健康 |
| `system_monitor_handler.go:106-116` | `GET /overview` | 上面三个聚合 |
| `system_monitor_handler.go:120-123` | `GET /containers` | 容器概览(过滤 aetherblog-* + linkedTargets) |
| `system_monitor_handler.go:128-152` | `GET /containers/:id/logs?tail=200` | 单容器日志 |
| `system_monitor_handler.go:157-197` | `GET /logs?level=&limit=&keyword=&cursor=` | 应用日志读取 |
| `system_monitor_handler.go:201-204` | `GET /logs/files` | 可用日志文件列表 |
| `system_monitor_handler.go:209-216` | `GET /logs/download?level=` | 文件下载 |
| `system_monitor_handler.go:221-299` | `POST /network/test` | TCP 连通性测试 |
| `system_monitor_handler.go:304-310` | `GET /history?minutes=&maxPoints=` | 历史指标 |
| `system_monitor_handler.go:314-317` | `GET /history/stats` | 历史数据规模 |
| `system_monitor_handler.go:321-324` | `DELETE /history` | 清空历史 |
| `system_monitor_handler.go:328-331` | `GET /alerts` | 最近 1h 内活跃告警 |
| `system_monitor_handler.go:335-338` | `GET /config` | 阈值 / 间隔配置 |

加上:
- `apps/server-go/internal/handler/system_handler.go:18-20` `GET /v1/admin/system/time` —— 服务器时间(Java 兼容)。
- `apps/server-go/internal/handler/log_level_handler.go:42-45` `GET/PUT /v1/admin/system/log-level` —— backend + ai-service 日志级别热改。

### Service

| file | 行数 | 责任 |
| --- | --- | --- |
| `service/system_monitor.go` | 448 | 平台特化采集 (macOS top/sysctl/vm_stat/netstat,Linux /proc/*) |
| `service/container_monitor.go` | 497 | Docker API client + cache + singleflight + linkedTargets |
| `service/log_viewer.go` | 438 | 多文件聚合读 + 按 level 过滤 + tail 偏移分页 |
| `service/metrics_history.go` | 411 | 后台 30s 采集 goroutine + 24h 滑动窗口 + 阈值告警 |

### 路由挂载

`server.go:223-244`:

```go
systemGroup := admin.Group("/system")
handler.NewSystemHandler().MountAdmin(systemGroup)            // /time

sysMonitorSvc := service.NewSystemMonitorService(s.Config)
containerMonitorSvc := service.NewContainerMonitorService(
    s.Config.Monitor.DockerEndpoint,
    service.LinkedTarget{Host: s.Config.Redis.Host,    Port: s.Config.Redis.Port,    ImageHint: "redis"},
    service.LinkedTarget{Host: s.Config.Database.Host, Port: s.Config.Database.Port, ImageHint: "postgres"},
)
logViewerSvc := service.NewLogViewerService(s.Config)
metricsHistorySvc := service.NewMetricsHistoryService(sysMonitorSvc)
metricsHistorySvc.Start(bgCtx)                                  // 启动 30s 采集 goroutine

handler.NewSystemMonitorHandler(
    sysMonitorSvc, containerMonitorSvc, logViewerSvc, metricsHistorySvc,
    s.DB, s.Redis, s.Config,
).MountAdmin(systemGroup)

handler.NewLogLevelHandler(s.Config, aiClient).MountAdmin(systemGroup)  // /log-level
```

## 3. 数据流

### 3.1 实时指标采集

`SystemMonitorService.CollectMetrics()` (`system_monitor.go:96-133`):

```
m.CPU.Cores = runtime.NumCPU()
m.CPU.UsagePercent = collectCPUUsage()
   ├── darwin → exec("top -l 1 -n 0 -stats cpu") 解析 "X% idle" → 100-idle
   └── linux  → cat /proc/stat 第一行 (user nice system idle), 与上次差分计算
runtime.ReadMemStats(&ms) → Go 堆内存
collectOSMemory(&m.Memory)
   ├── darwin → sysctl hw.memsize + vm_stat (free + inactive pages)
   └── linux  → /proc/meminfo (MemTotal / MemFree / MemAvailable)
collectDisk()
   └── syscall.Statfs(cfg.Upload.Path) → 块设备级
collectNetwork()
   ├── darwin → netstat -ib | grep en0 → bytesIn/bytesOut
   └── linux  → /proc/net/dev | grep eth0 ens → 累加
   差分计算 bytes/s 实时速率(NetworkMetrics.SpeedIn/SpeedOut)
m.Go = { Version, NumGoroutine, NumGC, Uptime }
```

依赖 `s.cfg.Upload.Path` 的现实存在 —— `collectDisk` 看的是上传目录所在块设备,不是根分区。

### 3.2 历史指标 24h 窗口

`MetricsHistoryService.Start(ctx)` (`metrics_history.go:124-142`):

```
go func {
    ticker = NewTicker(30s)
    collect()                  // 立即采集一次
    loop {
        select {
            case <-ctx.Done(): return
            case <-ticker.C:    collect()
        }
    }
}
```

`collect()` 把 `MetricSnapshot{ts, cpu, memory, disk, networkIn, networkOut}` 追加到 `[]MetricSnapshot`,`cutoff = now - 24h`,trim 掉旧的。然后 `checkAlerts(snap)`。

`checkAlerts`(`metrics_history.go:172-206`):

```
for each metric in {cpu, mem, disk}:
    if value > threshold:
        violations++
    else:
        violations = 0
    if violations >= 5:                    // 连续 5 次超阈值才告警
        addAlert(metric, level, value, threshold, msg)

addAlert:
    if 同 metric 在过去 5 分钟有告警: skip      // 去重
    push 到 alerts[]
    if len(alerts) > 100: 截前 100             // 滑动队列
```

阈值硬编码:`cpu=80% / mem=85% / disk=90%`(`metrics_history.go:88-92`)。

### 3.3 历史 GET 与降采样

`GetHistory(minutes=60, maxPoints=120)` (`metrics_history.go:233-290`):

```
cutoff = now - minutes
filtered = snapshots where ts > cutoff
if len(filtered) > maxPoints:
    filtered = downsample(filtered, maxPoints)    // 桶内平均
return MetricHistory { CPU/Memory/Disk/Network arrays }
```

`downsample`(`metrics_history.go:374-410`):桶大小 = `len/maxPoints`,每桶取 timestamp 中点 + cpu/mem/disk/networkIn/networkOut 平均。

### 3.4 容器监控

`ListContainers()` (`container_monitor.go:212-228`):

```
1) RLock check cache:
     if cachedAt within 3s:  return deep-copy of cachedData
2) 用 singleflight ("list" key):  fetchContainers()
```

`fetchContainers()` (`container_monitor.go:231-359`):

```
a) socketOK() 预检:
     unix → os.Stat(socketPath)
     http → url.Parse(base)
b) GET /containers/json?all=true&filters={"label":["com.docker.compose.project"]}
   (有 linkedTargets 时不用 label filter,因为外部容器没这 label)
c) decode JSON → 过滤 name contains "aetherblog" || compose project = "aetherblog" || matchesLinkedTarget()
d) 对每个 running 容器并发 GET /containers/{id}/stats?stream=false
   计算 cpuPercent = (cpuDelta / sysDelta) * cpus * 100
```

`matchesLinkedTarget`(`container_monitor.go:161-187`)按两档匹配:

| Host 形态 | 策略 |
| --- | --- |
| 容器名 / compose 服务名 | 严格 EqualFold,不看端口和镜像 |
| IP 字面量 | port + ImageHint 双重指纹(`Postgres on 5432 with image contains "postgres"`) |

刻意区分两档防止「外部 my_postgres + aetherblog-postgres 同时存在,port+image 匹配把两个都抓进来」。

### 3.5 日志读取

`LogViewerService.ReadLogs(level, limit, keyword, cursor)` (`log_viewer.go:131-164`):

| level | 行为 |
| --- | --- |
| `"ALL"` | `readAggregated`(无 level filter) |
| `"INFO"/"WARN"/"ERROR"/"DEBUG"` | `readAggregated`(按 JSON `level` 字段过滤) |
| `"BACKEND"/"AI"` | `readSingleFile`(单文件) |

`readAggregated`(`log_viewer.go:169-253`)对每个服务文件:

1. 用游标的 offset(没有就用文件末尾),`readTailLines(f, offset, limit*2, "")` 拿候选。
2. 每行 JSON 解析,提取 `timestamp` + `level`,应用 keyword + level filter。
3. 全部合并按 `timestamp ASC` 排序。
4. 取最后 `limit` 条。

游标格式:`Base64(JSON({"backend": offset, "ai-service": offset}))`,兼容旧版纯整数(视作 backend offset)。

`readTailLines`(`log_viewer.go:362-417`)按块从文件 `endOffset` 向前读 `limit*512` 字节,跳过第一不完整行,逐行读到 EOF。

**SECURITY:** `system_monitor_handler.go:165-185` 把 `limit` 钳位到 [1, 1000],防止 admin `limit=1_000_000` 把整个 ai-service.log 拉爆响应。

### 3.6 网络连通性测试

`POST /v1/admin/system/network/test` (`system_monitor_handler.go:221-299`):

预设测试目标:
1. Google DNS `8.8.8.8:53`
2. Cloudflare DNS `1.1.1.1:53`
3. AI Service(从 `cfg.AI.BaseURL` 解析)
4. PostgreSQL(`cfg.Database.Host:Port`)
5. Redis(`cfg.Redis.Addr()`)

每个目标 `net.DialTimeout("tcp", addr, 3*time.Second)`,记录延迟(微秒精度转毫秒)。失败带 `err.Error()`。返回 `{status:"completed", results:[...], timestamp}`。

### 3.7 日志级别热改

`PUT /v1/admin/system/log-level`(`log_level_handler.go:81-126`):

```
{"backend":"info","aiService":"info"}
  ├── backend → zerolog.SetGlobalLevel(lvl) 在线生效
  │   用 lvl 自身记录变更事件 (避免切到 Warn 后变更日志被屏蔽)
  └── aiService → POST /api/v1/admin/log-level (ai-service)
      X-Internal-Service token
      ai-service 改 root logger
```

**不持久化**。重启后回到 env / config.yaml 配置。

## 4. DB 表 / 索引

无监控专用表。

storage breakdown 的 DB 大小通过 `pg_database_size(current_database())` 实时计算,Redis 大小通过 `INFO memory` 取 `used_memory`。这些都是采样,不入表。

## 5. 配置 / 环境变量

| Env / config | 默认 | 含义 |
| --- | --- | --- |
| `AETHERBLOG_MONITOR_DOCKER_ENDPOINT` | `""` (= `/var/run/docker.sock`) | Docker daemon 端点;支持 `unix://...` / `/path/to/sock` / `http(s)://proxy:2375` |
| `AETHERBLOG_LOG_PATH` | `./logs` | 日志目录,`backend.log` / `ai-service.log` 都在这里 |
| `AETHERBLOG_UPLOAD_PATH` | `./uploads` | 上传目录,`collectDisk` 看这个目录所在块设备 |
| 硬编码 | `collectInterval = 30s` | metrics_history.go:84 |
| 硬编码 | `retentionPeriod = 24h` | metrics_history.go:86 |
| 硬编码 | `cpuThreshold=80%, memThreshold=85%, diskThreshold=90%` | metrics_history.go:88-92 |
| 硬编码 | `sustainedCount=5` | metrics_history.go:94 |
| 硬编码 | `containerCacheTTL=3s` | container_monitor.go:93 |
| 硬编码 | `client Timeout=5s` (Docker API) | container_monitor.go:110, 137 |
| 硬编码 | `logsMaxLimit=1000` | system_monitor_handler.go:167 |
| 硬编码 | `defaultBandwidth=12_500_000 B/s` (100Mbps) | system_monitor_handler.go:524 |

## 6. 与其他模块耦合

| 调用方向 | 形式 |
| --- | --- |
| `system_monitor_handler ↔ DB / Redis` | 直接持引用,做 ping + storage size |
| `system_monitor_handler → s.Config.AI.BaseURL` | health 探测 + network test 用 |
| `metrics_history` → `system_monitor` | 30s 采集委托 |
| `log_level_handler → ai_client` | 跨服务推 log level 改动 |
| `Trace 中间件` → `isHealthProbePath` | 把 `/api/v1/admin/system/health` `/metrics` 等 2xx 探活直接不落访问日志,4xx 仍按状态码升级 |
| `flattenMetrics` → 前端 admin UI | 字段名 (cpuUsage, memoryPercent 等) 与前端硬绑,改名要同步 |

## 7. 已知限制 / 待改进

### 7.1 历史指标重启即丢

`MetricsHistoryService` 完全在内存。进程重启 = 24h 历史清零。详见 README §6.6。

### 7.2 阈值不可调

`cpuThreshold=80 / memThreshold=85 / diskThreshold=90` 硬编码 const。`GetConfig` 端点把它们暴露成响应,但没有对应的 PUT 端点。前端 UI 看上去能改但实际无地方落地。

### 7.3 平台支持只有 Linux + macOS

`collectCPUUsage` `collectOSMemory` `collectNetwork` 三个平台特化方法在 Windows 上全部走 fallback 返回零值。如果有人 GOOS=windows 构建,监控面板会显示 "0% CPU 0% Memory" 误以为机器闲。

### 7.4 macOS 网卡只读 en0

`collectNetwork` 在 darwin 平台 hardcode `en0`。Mac mini 用 USB-C 千兆口、雷电桥接、VPN 都不是 en0。这是开发者本地 monitor 的实际数值不准的根因。

### 7.5 Docker socket 安全

`container_monitor.go` 注释明确推荐 `tecnativa/docker-socket-proxy`,但默认值是 `""` 解析成 `/var/run/docker.sock` 直连。生产环境如果按默认部署,backend 容器需要把 docker socket bind-mount 进去 + 加入 docker 组,这等同于把宿主机 root 权限给了 backend。详见 README §6.4。

### 7.6 stats handler 软失败行为

`Dashboard` 软失败到零值是仪表盘需要的设计;但**告警 / 健康检查端点也软失败**就有问题。比如 `GetHealth` 里 ai-service 不可达只返回 `status:"down"` 不报 5xx,nginx 健康监控 / 探活脚本无法仅靠 HTTP 状态判断 —— 必须解析 JSON。

### 7.7 log_level Update 错误时 backend 已改 ai-service 还没改

`Update` 逻辑(`log_level_handler.go:81-126`)先 `zerolog.SetGlobalLevel`(立即生效),再 `pushAIServiceLevel`(可能失败)。失败时 backend 已 debug,ai-service 仍旧。这种 partial update 会让运维以为「全切到 debug」实际只切了一半。建议改成「先两侧探测能否切 → 都能 → 一起切」。

### 7.8 logs/download 没有 size limit

`DownloadLog` 直接 `c.Attachment(path, filename)`。如果 `backend.log` 被某次故障打到 5GB,admin 一点下载,Go 进程内存 OK(c.Attachment 走 io.Copy 流式),但 nginx 可能因为 proxy_buffering 把它先缓冲到磁盘。建议加 size 检查和 `Content-Length` 头。

### 7.9 readAggregated 排序耗 CPU

`readAggregated` 把每个文件的最后 `limit*2 = 200` 行解 JSON 后归并排序。每次请求都重做。如果有人 20 秒内连续点「刷新」,backend CPU 会被 JSON 解析吃掉。建议加 LRU 缓存(key = level+keyword+limit+cursor)。

## 8. 测试覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `apps/server-go/internal/service/container_monitor_test.go` (158 行) | `matchesLinkedTarget` 各分支(IP / 容器名 / port+image fingerprint),Docker socket fallback |
| 没有 `system_monitor_test.go` | 平台特化采集纯依赖外部命令,难单测;集成测试由部署后人工验证 |
| 没有 `log_viewer_test.go` | tail / aggregate 排序 / cursor 编码无单测 |
| 没有 `metrics_history_test.go` | 30s 采集 / 24h trim / 告警去重 / 降采样无单测 |
| 没有 `log_level_handler_test.go` | partial update 行为无验证 |

监控模块整体测试薄弱,主要靠生产环境烟雾测试。
