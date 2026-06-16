package service

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// validContainerID 匹配合法的 Docker 容器 ID 或名称，防止路径注入攻击。
var validContainerID = regexp.MustCompile(`^[a-f0-9]{12,64}$`)

// ContainerOverview 汇总所有 Docker 容器的状态概览信息。
type ContainerOverview struct {
	Containers        []ContainerInfo `json:"containers"`             // 各容器详情列表
	TotalContainers   int             `json:"totalContainers"`        // 容器总数
	RunningContainers int             `json:"runningContainers"`      // 运行中的容器数
	TotalMemoryUsed   int64           `json:"totalMemoryUsed"`        // 所有容器内存使用总量（字节）
	TotalMemoryLimit  int64           `json:"totalMemoryLimit"`       // 所有容器内存限额总量（字节）
	AvgCpuPercent     float64         `json:"avgCpuPercent"`          // 所有容器的平均 CPU 使用率（%）
	DockerAvailable   bool            `json:"dockerAvailable"`        // Docker daemon 是否可达
	ErrorMessage      string          `json:"errorMessage,omitempty"` // Docker 不可达时的具体原因（如 socket 不存在 / 代理无响应）
	Source            string          `json:"source,omitempty"`       // 数据来源描述（如 "unix:///var/run/docker.sock" 或代理 URL），便于排错
}

// ContainerInfo 表示单个 Docker 容器的运行时信息。
type ContainerInfo struct {
	ID            string  `json:"id"`            // 容器 ID（取前 12 位）
	Name          string  `json:"name"`          // 容器名称
	DisplayName   string  `json:"displayName"`   // 去除项目前缀后的展示名
	Status        string  `json:"status"`        // 容器状态描述（如 "Up 2 hours"）
	State         string  `json:"state"`         // 容器状态（running/exited 等）
	CpuPercent    float64 `json:"cpuPercent"`    // CPU 使用率（%）
	MemoryUsed    int64   `json:"memoryUsed"`    // 内存使用量（字节）
	MemoryLimit   int64   `json:"memoryLimit"`   // 内存限额（字节）
	MemoryPercent float64 `json:"memoryPercent"` // 内存使用率（%）
	Image         string  `json:"image"`         // 镜像名称
	Type          string  `json:"type"`          // 容器类型（database/cache/search 等）
}

// LinkedTarget 描述一个"非 aetherblog-* 前缀,但被应用实际连接"的外部依赖容器。
// 监控把它纳入容器列表,避免用户用外部 Redis/Postgres 时看不到实际后端的健康状况。
type LinkedTarget struct {
	Host      string // 配置里的主机名或 IP(如 redis-server / 124.22.30.10)
	Port      int    // 应用侧连接端口(匹配容器 PublicPort 时用)
	ImageHint string // 期望容器镜像包含的关键字(如 "redis" / "postgres"),降低误匹配风险
}

// ContainerMonitorService 通过 Docker Engine API 提供容器监控功能。
// 支持两种连接方式：本地 Unix socket（默认 /var/run/docker.sock）或 HTTP(S) 代理 URL
// （如 tecnativa/docker-socket-proxy），由 endpoint 决定。
// 内置缓存机制：缓存有效期内直接返回上次结果，避免频繁请求 Docker daemon。
// 使用 singleflight 防止缓存过期瞬间的并发击穿。
type ContainerMonitorService struct {
	client   *http.Client
	endpoint string       // 描述性字符串，例如 "unix:///var/run/docker.sock" 或 "http://docker-socket-proxy:2375"
	baseURL  string       // HTTP 请求 URL 前缀（unix 模式下固定为 "http://docker"）
	socketOK func() error // 启动前快速探测 endpoint 是否可达；返回非 nil 即视为不可用

	cacheMu    sync.RWMutex
	cachedData *ContainerOverview
	cachedAt   time.Time
	cacheTTL   time.Duration
	sfGroup    singleflight.Group

	linkedTargets []LinkedTarget // 配置里声明的外部依赖(通常是 Redis/Postgres)
}

// NewContainerMonitorService 创建 ContainerMonitorService 实例。
//
// dockerEndpoint 控制连接目标：
//   - "" 或以 "unix://" / "/" 开头 —— 视为 Unix socket 路径，默认 /var/run/docker.sock。
//   - "http://" / "https://" 开头 —— 视为 docker-socket-proxy 等 HTTP 代理 URL。
//
// 推荐生产部署：front Docker daemon with tecnativa/docker-socket-proxy 限制为
// /containers/json + /containers/*/stats 只读访问，再把 URL 设给本服务。
// 详见 docs/deployment.md "容器监控" 节。
//
// linkedTargets 允许把"非 aetherblog 项目但实际被连接的"容器（如外部 Redis/Postgres）
// 也纳入监控。
func NewContainerMonitorService(dockerEndpoint string, linkedTargets ...LinkedTarget) *ContainerMonitorService {
	svc := &ContainerMonitorService{
		cacheTTL:      3 * time.Second,
		linkedTargets: linkedTargets,
	}

	// 协议判定：HTTP(S) 走代理；其他一律按 Unix socket 处理
	if strings.HasPrefix(dockerEndpoint, "http://") || strings.HasPrefix(dockerEndpoint, "https://") {
		// 代理模式：剥掉尾部斜杠避免拼接出 //containers
		base := strings.TrimRight(dockerEndpoint, "/")
		// baseURL 必须保留 userinfo —— 真正的 HTTP 请求要带凭据；
		// endpoint 用于 UI 展示,任何凭据都得 redact 掉,避免随 ContainerOverview.Source
		// 漏给浏览器(管理员的 DevTools / 截图都会泄露)。
		displayEndpoint := base
		if u, err := url.Parse(base); err == nil {
			displayEndpoint = u.Redacted()
		}
		svc.endpoint = displayEndpoint
		svc.baseURL = base
		svc.client = &http.Client{Timeout: 5 * time.Second}
		svc.socketOK = func() error {
			// 代理可达性探测：能解析 URL 即视为已配置；实际连通性由请求阶段返回的错误反映。
			if _, err := url.Parse(base); err != nil {
				return fmt.Errorf("invalid DOCKER_SOCKET_PROXY_URL %q: %w", displayEndpoint, err)
			}
			return nil
		}
		return svc
	}

	socketPath := strings.TrimPrefix(dockerEndpoint, "unix://")
	if socketPath == "" {
		socketPath = "/var/run/docker.sock"
	}
	svc.endpoint = "unix://" + socketPath
	svc.baseURL = "http://docker"
	dialer := &net.Dialer{}
	svc.client = &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				// 走 Dialer.DialContext 让上层请求 ctx 的超时/取消能传到 unix dial 阶段;
				// 直接 net.Dial 会忽略 ctx,长时间挂起的请求无法被中断。
				return dialer.DialContext(ctx, "unix", socketPath)
			},
		},
		Timeout: 5 * time.Second,
	}
	svc.socketOK = func() error {
		// 直接 stat 一下 socket 文件 —— 不存在或不是 socket 时给出可读的错误，
		// 比让 fetchContainers 撞到 dial unix 的底层错误更友好。
		info, err := os.Stat(socketPath)
		if err != nil {
			return fmt.Errorf("docker socket unavailable at %s: %w", socketPath, err)
		}
		if info.Mode()&os.ModeSocket == 0 {
			return fmt.Errorf("docker socket path %s exists but is not a unix socket", socketPath)
		}
		return nil
	}
	return svc
}

// matchesLinkedTarget 判断一个容器是否是配置里声明的外部依赖。
// 匹配分两档,按 Host 形态二选一,绝不同时启用以避免宿主机上另一个
// 同端口同镜像的无关容器(如 my_postgres)被误纳入:
//  1. Host 是容器名/compose 服务名(非 IP 字面量) —— 严格等于匹配,
//     不再看端口和镜像;否则 my_postgres 与 aetherblog-postgres 都有
//     postgres 镜像 + 5432 端口,port+image fallback 会把两者都抓进来。
//  2. Host 是 IP 字面量 —— 容器名无法比对,才退到 PublicPort + ImageHint
//     指纹匹配,覆盖 "REDIS_HOST=124.22.30.10" 这种场景。
func matchesLinkedTarget(c dockerContainer, name string, targets []LinkedTarget) bool {
	if len(targets) == 0 {
		return false
	}
	imageLower := strings.ToLower(c.Image)
	for _, t := range targets {
		if t.Host == "" {
			continue
		}
		if net.ParseIP(t.Host) == nil {
			// 非 IP: 只认容器名精确匹配(compose 服务名 / 自定义容器名)
			if strings.EqualFold(name, t.Host) {
				return true
			}
			continue
		}
		// IP 场景: 靠端口 + 镜像指纹识别实际后端容器
		if t.Port > 0 && t.ImageHint != "" && strings.Contains(imageLower, strings.ToLower(t.ImageHint)) {
			for _, p := range c.Ports {
				if p.PublicPort == t.Port {
					return true
				}
			}
		}
	}
	return false
}

// dockerContainer 是 Docker API /containers/json 响应体的 JSON 结构。
type dockerContainer struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	State  string            `json:"State"`
	Status string            `json:"Status"`
	Labels map[string]string `json:"Labels"`
	Ports  []dockerPort      `json:"Ports"` // 用于 linkedTargets 端口匹配
}

// dockerPort 对应 Docker API /containers/json 返回的端口映射子对象。
// PublicPort = 宿主机端口(可能为 0 表示仅容器内网暴露); PrivatePort = 容器内端口。
type dockerPort struct {
	IP          string `json:"IP"`
	PrivatePort int    `json:"PrivatePort"`
	PublicPort  int    `json:"PublicPort"`
	Type        string `json:"Type"`
}

// ListContainers 返回所有 aetherblog 相关 Docker 容器的实时状态概览。
// 优先通过 compose project label 过滤，回退到名称过滤；运行中的容器会附带实时 CPU/内存统计。
// 结果会缓存 cacheTTL 时间，避免短时间内重复请求 Docker API。
func (s *ContainerMonitorService) ListContainers() ContainerOverview {
	// 缓存命中则直接返回（深拷贝 Containers slice 防止调用方污染缓存）
	s.cacheMu.RLock()
	if s.cachedData != nil && time.Since(s.cachedAt) < s.cacheTTL {
		cached := *s.cachedData
		cached.Containers = make([]ContainerInfo, len(s.cachedData.Containers))
		copy(cached.Containers, s.cachedData.Containers)
		s.cacheMu.RUnlock()
		return cached
	}
	s.cacheMu.RUnlock()

	// 使用 singleflight 防止缓存过期瞬间多个并发请求同时刷新
	v, _, _ := s.sfGroup.Do("list", func() (interface{}, error) {
		return s.fetchContainers(), nil
	})
	return v.(ContainerOverview)
}

// fetchContainers 执行实际的 Docker API 调用并更新缓存。
func (s *ContainerMonitorService) fetchContainers() ContainerOverview {
	overview := ContainerOverview{
		Containers: []ContainerInfo{},
		Source:     s.endpoint,
	}

	// 端点预检：socket 文件不存在 / 代理 URL 非法时立刻给出可读错误,
	// 避免 UI 只看到一句"Docker API 不可用"而无从下手。
	if s.socketOK != nil {
		if err := s.socketOK(); err != nil {
			overview.ErrorMessage = err.Error()
			return overview
		}
	}

	// 有 linkedTargets 时必须拉全量 —— 外部容器(如用户自管的 redis-server)
	// 没有 com.docker.compose.project 标签,server-side label filter 会漏掉。
	// 没有 linkedTargets 时优先用 label 过滤省带宽。
	listURL := s.baseURL + "/containers/json?all=true"
	filteredURL := listURL
	if len(s.linkedTargets) == 0 {
		filteredURL += `&filters={"label":["com.docker.compose.project"]}`
	}
	resp, err := s.client.Get(filteredURL)
	if err != nil {
		// 回退：不带 label 过滤，获取全部容器后在本地过滤
		resp, err = s.client.Get(listURL)
		if err != nil {
			overview.ErrorMessage = fmt.Sprintf("docker API request failed: %v", err)
			return overview
		}
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		overview.ErrorMessage = fmt.Sprintf("docker API returned HTTP %d", resp.StatusCode)
		return overview
	}
	overview.DockerAvailable = true

	var containers []dockerContainer
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		overview.DockerAvailable = false
		overview.ErrorMessage = fmt.Sprintf("docker API returned malformed JSON: %v", err)
		return overview
	}

	// 仅保留 aetherblog 相关容器（按名称或 compose project 标签过滤）
	var infos []ContainerInfo
	var runningIndices []int    // 需要获取 stats 的容器索引
	var runningFullIDs []string // 对应的完整容器 ID
	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		project := c.Labels["com.docker.compose.project"]
		isAether := strings.Contains(name, "aetherblog") || project == "aetherblog"
		isLinked := !isAether && matchesLinkedTarget(c, name, s.linkedTargets)
		if !isAether && !isLinked {
			continue
		}

		// 优先使用 compose service label 推断类型和显示名，比解析容器名更可靠
		serviceName := c.Labels["com.docker.compose.service"]

		displayName := name // 默认显示完整容器名（匹配 docker ps）
		containerType := inferContainerType(name)
		if serviceName != "" {
			displayName = serviceName
			containerType = inferContainerType(serviceName)
		}

		info := ContainerInfo{
			ID:          c.ID[:12], // 仅取 ID 前 12 位
			Name:        name,
			DisplayName: displayName,
			Status:      c.Status,
			State:       c.State,
			Image:       c.Image,
			Type:        containerType,
		}

		if c.State == "running" {
			overview.RunningContainers++
			runningIndices = append(runningIndices, len(infos))
			runningFullIDs = append(runningFullIDs, c.ID)
		}

		infos = append(infos, info)
	}

	// 并行获取所有运行中容器的 CPU/内存统计，避免串行等待
	var wg sync.WaitGroup
	for i, idx := range runningIndices {
		wg.Add(1)
		go func(fullID string, infoPtr *ContainerInfo) {
			defer wg.Done()
			s.fillContainerStats(fullID, infoPtr)
		}(runningFullIDs[i], &infos[idx])
	}
	wg.Wait()

	// 汇总全局统计指标
	var totalMem, totalLimit int64
	var totalCpu float64
	for _, info := range infos {
		totalMem += info.MemoryUsed
		totalLimit += info.MemoryLimit
		totalCpu += info.CpuPercent
	}

	overview.Containers = infos
	overview.TotalContainers = len(infos)
	overview.TotalMemoryUsed = totalMem
	overview.TotalMemoryLimit = totalLimit
	if len(infos) > 0 {
		overview.AvgCpuPercent = totalCpu / float64(len(infos))
	}

	// 更新缓存
	s.cacheMu.Lock()
	s.cachedData = &overview
	s.cachedAt = time.Now()
	s.cacheMu.Unlock()

	return overview
}

// GetContainerLogs 返回指定容器的最后 N 行日志内容。
// 对容器 ID 进行正则校验以防止路径注入；解析并去除 Docker 日志流 8 字节帧头。
// 错误场景：容器 ID 格式非法、Docker API 请求失败、容器不存在或无法访问。
func (s *ContainerMonitorService) GetContainerLogs(containerID string, tail int) (string, error) {
	// 校验容器 ID 合法性，防止路径注入
	if !validContainerID.MatchString(containerID) {
		return "", fmt.Errorf("invalid container ID")
	}

	resp, err := s.client.Get(fmt.Sprintf("%s/containers/%s/logs?stdout=true&stderr=true&tail=%d", s.baseURL, containerID, tail))
	if err != nil {
		return "", fmt.Errorf("docker API error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("container not found or inaccessible")
	}

	// Docker 日志流每帧有 8 字节头，需完整读取后再解析
	buf := make([]byte, 0, 64*1024)
	tmp := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if err != nil {
			break
		}
	}

	// 去除 Docker 日志流帧头（每帧格式：[类型(1字节)][保留(3字节)][帧大小(4字节大端)]）
	var clean strings.Builder
	i := 0
	for i < len(buf) {
		if i+8 > len(buf) {
			break // 帧头不完整，停止处理
		}
		frameSize := int(binary.BigEndian.Uint32(buf[i+4 : i+8]))
		if frameSize <= 0 || i+8+frameSize > len(buf) {
			break // 帧大小无效或帧数据不完整，停止处理
		}
		clean.Write(buf[i+8 : i+8+frameSize])
		i += 8 + frameSize
	}

	return clean.String(), nil
}

// dockerStats 是 Docker API /containers/{id}/stats?stream=false 响应体的 JSON 结构。
type dockerStats struct {
	CPUStats    dockerCPUStats    `json:"cpu_stats"`
	PreCPUStats dockerCPUStats    `json:"precpu_stats"`
	MemoryStats dockerMemoryStats `json:"memory_stats"`
}

// dockerCPUStats 表示 Docker stats 中的 CPU 统计数据（当前或上一周期）。
type dockerCPUStats struct {
	CPUUsage    dockerCPUUsage `json:"cpu_usage"`
	SystemUsage uint64         `json:"system_cpu_usage"` // 系统级 CPU 总使用时间（纳秒）
	OnlineCPUs  int            `json:"online_cpus"`      // 可用 CPU 核心数
}

// dockerCPUUsage 表示容器的 CPU 使用时间。
type dockerCPUUsage struct {
	TotalUsage uint64 `json:"total_usage"` // 容器 CPU 总使用时间（纳秒）
}

// dockerMemoryStats 表示 Docker stats 中的内存统计数据。
type dockerMemoryStats struct {
	Usage uint64 `json:"usage"` // 当前内存使用量（字节）
	Limit uint64 `json:"limit"` // 内存限额（字节）
}

// fillContainerStats 通过 Docker API 获取单个容器的实时 CPU 和内存统计数据，并填充到 info 中。
// CPU 使用率计算公式：Δ容器CPU / Δ系统CPU * CPU核数 * 100。
func (s *ContainerMonitorService) fillContainerStats(fullID string, info *ContainerInfo) {
	resp, err := s.client.Get(fmt.Sprintf("%s/containers/%s/stats?stream=false", s.baseURL, fullID))
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return
	}

	var stats dockerStats
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return
	}

	// CPU 使用率 = (容器CPU增量 / 系统CPU增量) * CPU核数 * 100
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage)
	cpus := stats.CPUStats.OnlineCPUs
	if cpus == 0 {
		cpus = 1 // 防止除零，至少视为 1 核
	}
	if sysDelta > 0 && cpuDelta >= 0 {
		pct := (cpuDelta / sysDelta) * float64(cpus) * 100.0
		// 保留原始计算精度，避免后端提前四舍五入影响后续汇总；展示精度由前端控制。
		info.CpuPercent = pct
	}

	// 内存使用量及使用率
	usage := stats.MemoryStats.Usage
	if usage > math.MaxInt64 {
		usage = math.MaxInt64
	}
	info.MemoryUsed = int64(usage)

	limit := stats.MemoryStats.Limit
	if limit > math.MaxInt64 {
		limit = math.MaxInt64
	}
	info.MemoryLimit = int64(limit)
	if stats.MemoryStats.Limit > 0 {
		info.MemoryPercent = float64(stats.MemoryStats.Usage) / float64(stats.MemoryStats.Limit) * 100.0
	}
}

// inferContainerType 根据容器名称推断其类型，用于前端图标展示。
// 支持识别：database、cache、search、backend（Go）、blog（Next.js）、gateway（Nginx）、admin（Vite）、ai 等。
func inferContainerType(name string) string {
	switch {
	case strings.Contains(name, "postgres"):
		return "database"
	case strings.Contains(name, "redis"):
		return "cache"
	case strings.Contains(name, "elasticsearch") || strings.Contains(name, "elastic"):
		return "search"
	case strings.Contains(name, "backend"):
		return "backend"
	case strings.Contains(name, "blog"):
		return "blog"
	case strings.Contains(name, "gateway") || strings.Contains(name, "nginx"):
		return "gateway"
	case strings.Contains(name, "admin"):
		return "admin"
	case strings.Contains(name, "ai"):
		return "ai"
	default:
		return "other"
	}
}
