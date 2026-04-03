package service

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// validContainerID 匹配合法的 Docker 容器 ID 或名称，防止路径注入攻击。
var validContainerID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]+$`)

// ContainerOverview 汇总所有 Docker 容器的状态概览信息。
type ContainerOverview struct {
	Containers        []ContainerInfo `json:"containers"`        // 各容器详情列表
	TotalContainers   int             `json:"totalContainers"`   // 容器总数
	RunningContainers int             `json:"runningContainers"` // 运行中的容器数
	TotalMemoryUsed   int64           `json:"totalMemoryUsed"`   // 所有容器内存使用总量（字节）
	TotalMemoryLimit  int64           `json:"totalMemoryLimit"`  // 所有容器内存限额总量（字节）
	AvgCpuPercent     float64         `json:"avgCpuPercent"`     // 所有容器的平均 CPU 使用率（%）
	DockerAvailable   bool            `json:"dockerAvailable"`   // Docker daemon 是否可达
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

// ContainerMonitorService 通过 Docker Unix Socket API 提供容器监控功能。
// 内置缓存机制：缓存有效期内直接返回上次结果，避免频繁请求 Docker daemon。
type ContainerMonitorService struct {
	client *http.Client

	cacheMu    sync.RWMutex
	cachedData *ContainerOverview
	cachedAt   time.Time
	cacheTTL   time.Duration
}

// NewContainerMonitorService 创建 ContainerMonitorService 实例。
// 通过 Unix Socket（/var/run/docker.sock）连接 Docker daemon，请求超时为 5 秒。
// 结果缓存 3 秒，防止多客户端并发请求时重复访问 Docker API。
func NewContainerMonitorService() *ContainerMonitorService {
	return &ContainerMonitorService{
		client: &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					// 所有 HTTP 请求均通过 Docker Unix Socket 路由
					return net.Dial("unix", "/var/run/docker.sock")
				},
			},
			Timeout: 5 * time.Second,
		},
		cacheTTL: 3 * time.Second,
	}
}

// dockerContainer 是 Docker API /containers/json 响应体的 JSON 结构。
type dockerContainer struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	State  string            `json:"State"`
	Status string            `json:"Status"`
	Labels map[string]string `json:"Labels"`
}

// ListContainers 返回所有 aetherblog 相关 Docker 容器的实时状态概览。
// 优先通过 compose project label 过滤，回退到名称过滤；运行中的容器会附带实时 CPU/内存统计。
// 结果会缓存 cacheTTL 时间，避免短时间内重复请求 Docker API。
func (s *ContainerMonitorService) ListContainers() ContainerOverview {
	// 缓存命中则直接返回
	s.cacheMu.RLock()
	if s.cachedData != nil && time.Since(s.cachedAt) < s.cacheTTL {
		cached := *s.cachedData
		s.cacheMu.RUnlock()
		return cached
	}
	s.cacheMu.RUnlock()

	overview := ContainerOverview{
		Containers: []ContainerInfo{},
	}

	// 优先使用 compose project label 过滤，查询 aetherblog 相关容器
	resp, err := s.client.Get("http://docker/containers/json?all=true&filters=" +
		`{"label":["com.docker.compose.project"]}`)
	if err != nil {
		// 回退：不带 label 过滤，获取全部容器后在本地过滤
		resp, err = s.client.Get("http://docker/containers/json?all=true")
		if err != nil {
			return overview // Docker 不可用，返回空概览
		}
	}
	defer resp.Body.Close()
	overview.DockerAvailable = true

	var containers []dockerContainer
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return overview
	}

	// 仅保留 aetherblog 相关容器（按名称或 compose project 标签过滤）
	var infos []ContainerInfo
	var runningIndices []int // 需要获取 stats 的容器索引
	var runningFullIDs []string // 对应的完整容器 ID
	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		project := c.Labels["com.docker.compose.project"]
		if !strings.Contains(name, "aetherblog") && project != "aetherblog" {
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

	resp, err := s.client.Get(fmt.Sprintf("http://docker/containers/%s/logs?stdout=true&stderr=true&tail=%d", containerID, tail))
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
	resp, err := s.client.Get(fmt.Sprintf("http://docker/containers/%s/stats?stream=false", fullID))
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
		// 保留两位小数，避免极小值在前端 toFixed(1) 后显示为 0.0%
		info.CpuPercent = math.Round(pct*100) / 100
	}

	// 内存使用量及使用率
	info.MemoryUsed = int64(stats.MemoryStats.Usage)
	info.MemoryLimit = int64(stats.MemoryStats.Limit)
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
