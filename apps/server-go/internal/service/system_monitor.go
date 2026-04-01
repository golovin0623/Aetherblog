package service

import (
	"bufio"
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/config"
)

// SystemMetrics 聚合所有类别的系统指标数据。
type SystemMetrics struct {
	CPU     CPUMetrics     `json:"cpu"`
	Memory  MemoryMetrics  `json:"memory"`
	Disk    DiskMetrics    `json:"disk"`
	Network NetworkMetrics `json:"network"`
	Go      GoMetrics      `json:"go"`
}

// CPUMetrics 保存 CPU 使用率及配置信息。
type CPUMetrics struct {
	Cores        int     `json:"cores"`
	MaxProcs     int     `json:"maxProcs"`
	UsagePercent float64 `json:"usagePercent"`
}

// MemoryMetrics 保存操作系统内存和 Go 堆内存统计信息。
type MemoryMetrics struct {
	TotalBytes   uint64  `json:"totalBytes"`
	UsedBytes    uint64  `json:"usedBytes"`
	FreeBytes    uint64  `json:"freeBytes"`
	UsagePercent float64 `json:"usagePercent"`
	GoAllocBytes uint64  `json:"goAllocBytes"`
	GoSysBytes   uint64  `json:"goSysBytes"`
	GoHeapAlloc  uint64  `json:"goHeapAlloc"`
	GoHeapSys    uint64  `json:"goHeapSys"`
	GoTotalAlloc uint64  `json:"goTotalAlloc"`
}

// DiskMetrics 保存上传路径所在磁盘分区的使用情况。
type DiskMetrics struct {
	TotalBytes   uint64  `json:"totalBytes"`
	UsedBytes    uint64  `json:"usedBytes"`
	FreeBytes    uint64  `json:"freeBytes"`
	UsagePercent float64 `json:"usagePercent"`
	Path         string  `json:"path"`
}

// NetworkMetrics 保存累计的网络字节计数器（收发总量）及实时速率。
type NetworkMetrics struct {
	BytesIn  int64   `json:"bytesIn"`
	BytesOut int64   `json:"bytesOut"`
	SpeedIn  float64 `json:"speedIn"`  // bytes/s 实时接收速率
	SpeedOut float64 `json:"speedOut"` // bytes/s 实时发送速率
}

// GoMetrics 保存 Go 运行时统计信息（版本、协程数、GC 次数、运行时长）。
type GoMetrics struct {
	Version       string `json:"version"`
	NumGoroutine  int    `json:"numGoroutine"`
	NumGC         uint32 `json:"numGC"`
	Uptime        string `json:"uptime"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
}

// startTime 记录服务进程的启动时间，用于计算运行时长。
var startTime = time.Now()

// SystemMonitorService 负责采集系统级别的各项指标。
// 支持 macOS 和 Linux 平台，通过系统命令获取 CPU、内存、磁盘、网络数据。
type SystemMonitorService struct {
	cfg *config.Config

	// 用于网络字节计数的增量计算（存储上次采集值）
	mu             sync.Mutex
	lastNetIn      int64
	lastNetOut     int64
	lastNetCollect time.Time

	// 用于 Linux 下 CPU 使用率的增量计算（存储上次 /proc/stat 读数）
	lastCPUTotal  float64
	lastCPUActive float64
}

// NewSystemMonitorService 创建一个由给定配置支持的 SystemMonitorService 实例。
func NewSystemMonitorService(cfg *config.Config) *SystemMonitorService {
	return &SystemMonitorService{cfg: cfg}
}

// CollectMetrics 一次性采集所有类别的系统指标并返回聚合结果。
func (s *SystemMonitorService) CollectMetrics() SystemMetrics {
	var m SystemMetrics

	// CPU 指标
	m.CPU.Cores = runtime.NumCPU()
	m.CPU.MaxProcs = runtime.GOMAXPROCS(0)
	m.CPU.UsagePercent = s.collectCPUUsage()

	// Go 堆内存统计
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	m.Memory.GoAllocBytes = ms.Alloc
	m.Memory.GoSysBytes = ms.Sys
	m.Memory.GoHeapAlloc = ms.HeapAlloc
	m.Memory.GoHeapSys = ms.HeapSys
	m.Memory.GoTotalAlloc = ms.TotalAlloc
	// 操作系统内存统计（平台相关）
	s.collectOSMemory(&m.Memory)

	// 磁盘指标
	m.Disk = s.collectDisk()

	// 网络指标
	m.Network = s.collectNetwork()

	// Go 运行时信息
	uptime := time.Since(startTime)
	m.Go = GoMetrics{
		Version:       runtime.Version(),
		NumGoroutine:  runtime.NumGoroutine(),
		NumGC:         ms.NumGC,
		Uptime:        formatDuration(uptime),
		UptimeSeconds: int64(uptime.Seconds()),
	}

	return m
}

// collectCPUUsage 采集当前 CPU 使用率百分比。
// macOS：通过 top 命令读取空闲率后计算使用率；
// Linux：读取 /proc/stat 并与上次读数求差分，计算实际使用率；
// 其他平台或采集失败时返回 0。
func (s *SystemMonitorService) collectCPUUsage() float64 {
	if runtime.GOOS == "darwin" {
		out, err := exec.Command("top", "-l", "1", "-n", "0", "-stats", "cpu").Output()
		if err == nil {
			lines := strings.Split(string(out), "\n")
			for _, line := range lines {
				if strings.Contains(line, "CPU usage") {
					// 格式示例："CPU usage: 5.26% user, 10.52% sys, 84.21% idle"
					parts := strings.Split(line, ",")
					for _, p := range parts {
						p = strings.TrimSpace(p)
						if strings.Contains(p, "idle") {
							val := strings.TrimSuffix(strings.Fields(p)[0], "%")
							idle, e := strconv.ParseFloat(val, 64)
							if e == nil {
								return 100 - idle
							}
						}
					}
				}
			}
		}
	} else if runtime.GOOS == "linux" {
		// 读取 /proc/stat 首行并与上次读数差分，计算 CPU 使用率
		out, err := exec.Command("sh", "-c", "head -1 /proc/stat").Output()
		if err == nil {
			fields := strings.Fields(string(out))
			if len(fields) >= 5 {
				user, _ := strconv.ParseFloat(fields[1], 64)
				nice, _ := strconv.ParseFloat(fields[2], 64)
				system, _ := strconv.ParseFloat(fields[3], 64)
				idle, _ := strconv.ParseFloat(fields[4], 64)
				total := user + nice + system + idle
				active := total - idle

				s.mu.Lock()
				prevTotal := s.lastCPUTotal
				prevActive := s.lastCPUActive
				s.lastCPUTotal = total
				s.lastCPUActive = active
				s.mu.Unlock()

				deltaTotal := total - prevTotal
				deltaActive := active - prevActive
				if prevTotal > 0 && deltaTotal > 0 {
					return deltaActive / deltaTotal * 100
				}
			}
		}
	}
	return 0
}

// collectOSMemory 采集操作系统级别的内存使用情况，结果写入 m。
// macOS：通过 sysctl 获取总内存，通过 vm_stat 获取空闲和非活跃页计算可用内存；
// Linux：解析 /proc/meminfo，优先使用 MemAvailable 计算可用内存。
func (s *SystemMonitorService) collectOSMemory(m *MemoryMetrics) {
	if runtime.GOOS == "darwin" {
		// 获取物理内存总量
		out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
		if err == nil {
			total, e := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
			if e == nil {
				m.TotalBytes = total
			}
		}
		// 通过 vm_stat 计算可用内存（空闲页 + 非活跃页）
		out, err = exec.Command("vm_stat").Output()
		if err == nil {
			pageSize := uint64(16384) // Apple Silicon 默认页大小
			psOut, psErr := exec.Command("sysctl", "-n", "hw.pagesize").Output()
			if psErr == nil {
				ps, e := strconv.ParseUint(strings.TrimSpace(string(psOut)), 10, 64)
				if e == nil {
					pageSize = ps
				}
			}
			var free, inactive uint64
			scanner := bufio.NewScanner(strings.NewReader(string(out)))
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "Pages free:") {
					free = parseVMStatValue(line) * pageSize
				} else if strings.HasPrefix(line, "Pages inactive:") {
					inactive = parseVMStatValue(line) * pageSize
				}
			}
			// 可用内存 = 空闲页 + 非活跃页（非活跃页可被系统随时回收）
			m.FreeBytes = free + inactive
			if m.TotalBytes > 0 {
				m.UsedBytes = m.TotalBytes - m.FreeBytes
				m.UsagePercent = float64(m.UsedBytes) / float64(m.TotalBytes) * 100
			}
		}
	} else if runtime.GOOS == "linux" {
		out, err := exec.Command("sh", "-c", "cat /proc/meminfo").Output()
		if err == nil {
			var total, free, available uint64
			scanner := bufio.NewScanner(strings.NewReader(string(out)))
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "MemTotal:") {
					total = parseMemInfoValue(line) * 1024
				} else if strings.HasPrefix(line, "MemFree:") {
					free = parseMemInfoValue(line) * 1024
				} else if strings.HasPrefix(line, "MemAvailable:") {
					available = parseMemInfoValue(line) * 1024
				}
			}
			m.TotalBytes = total
			// 优先使用 MemAvailable（更准确地反映可用内存）
			if available > 0 {
				m.FreeBytes = available
			} else {
				m.FreeBytes = free
			}
			m.UsedBytes = total - m.FreeBytes
			if total > 0 {
				m.UsagePercent = float64(m.UsedBytes) / float64(total) * 100
			}
		}
	}
}

// collectDisk 采集配置的上传路径所在磁盘分区的使用情况。
// 通过 syscall.Statfs 获取块设备信息计算总量、已用量和可用量。
func (s *SystemMonitorService) collectDisk() DiskMetrics {
	path := s.cfg.Upload.Path
	if path == "" {
		path = "."
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return DiskMetrics{Path: path}
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	used := total - free
	var pct float64
	if total > 0 {
		pct = float64(used) / float64(total) * 100
	}
	return DiskMetrics{
		TotalBytes:   total,
		UsedBytes:    used,
		FreeBytes:    free,
		UsagePercent: pct,
		Path:         path,
	}
}

// collectNetwork 采集当前的网络累计收发字节数，并通过差分计算实时速率。
// macOS：解析 netstat -ib 输出，取 en0 接口数据；
// Linux：解析 /proc/net/dev，累计 eth0 和 ens* 接口数据；
// 采集失败时返回零值。
func (s *SystemMonitorService) collectNetwork() NetworkMetrics {
	var bytesIn, bytesOut int64

	if runtime.GOOS == "darwin" {
		out, err := exec.Command("netstat", "-ib").Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(out)))
			for scanner.Scan() {
				line := scanner.Text()
				fields := strings.Fields(line)
				// 列顺序：Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes
				if len(fields) >= 10 && strings.HasPrefix(fields[0], "en0") {
					in, _ := strconv.ParseInt(fields[6], 10, 64)
					out, _ := strconv.ParseInt(fields[9], 10, 64)
					if in > 0 {
						bytesIn = in
						bytesOut = out
						break
					}
				}
			}
		}
	} else if runtime.GOOS == "linux" {
		out, err := exec.Command("sh", "-c", "cat /proc/net/dev").Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(out)))
			for scanner.Scan() {
				line := scanner.Text()
				// 累计 eth0 和 ens* 系列网卡的流量
				if strings.Contains(line, "eth0") || strings.Contains(line, "ens") {
					parts := strings.Split(line, ":")
					if len(parts) == 2 {
						fields := strings.Fields(parts[1])
						if len(fields) >= 9 {
							in, _ := strconv.ParseInt(fields[0], 10, 64)
							out, _ := strconv.ParseInt(fields[8], 10, 64)
							bytesIn += in
							bytesOut += out
						}
					}
				}
			}
		}
	}

	// 通过与上次采集的差值计算实时速率 (bytes/s)
	var speedIn, speedOut float64
	now := time.Now()

	s.mu.Lock()
	if s.lastNetCollect.IsZero() || bytesIn == 0 {
		// 首次采集，无法计算速率
		s.lastNetIn = bytesIn
		s.lastNetOut = bytesOut
		s.lastNetCollect = now
	} else {
		elapsed := now.Sub(s.lastNetCollect).Seconds()
		if elapsed > 0 {
			deltaIn := bytesIn - s.lastNetIn
			deltaOut := bytesOut - s.lastNetOut
			// 防止计数器回绕导致负值
			if deltaIn >= 0 {
				speedIn = float64(deltaIn) / elapsed
			}
			if deltaOut >= 0 {
				speedOut = float64(deltaOut) / elapsed
			}
		}
		s.lastNetIn = bytesIn
		s.lastNetOut = bytesOut
		s.lastNetCollect = now
	}
	s.mu.Unlock()

	return NetworkMetrics{
		BytesIn:  bytesIn,
		BytesOut: bytesOut,
		SpeedIn:  speedIn,
		SpeedOut: speedOut,
	}
}

// StorageBreakdown 包含各存储子系统的使用情况明细。
type StorageBreakdown struct {
	Uploads     StorageItem `json:"uploads"`
	Database    StorageItem `json:"database"`
	Logs        StorageItem `json:"logs"`
	Redis       StorageItem `json:"redis"`
	TotalSize   int64       `json:"totalSize"`
	UsedSize    int64       `json:"usedSize"`
	UsedPercent float64     `json:"usedPercent"`
}

// StorageItem 保存单个存储子系统的大小信息。
type StorageItem struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	FileCount int    `json:"fileCount"`
	Formatted string `json:"formatted"`
}

// FormatBytes 将字节数格式化为人类可读的字符串（如 1.5 MB）。
func FormatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	val := float64(b) / float64(div)
	units := []string{"KB", "MB", "GB", "TB"}
	return fmt.Sprintf("%.1f %s", val, units[exp])
}

// parseVMStatValue 从 vm_stat 输出的单行中提取数值（页数）。
// 输入格式："Pages free:  12345."，返回 12345。
func parseVMStatValue(line string) uint64 {
	parts := strings.Split(line, ":")
	if len(parts) < 2 {
		return 0
	}
	val := strings.TrimSpace(parts[1])
	val = strings.TrimSuffix(val, ".")
	v, _ := strconv.ParseUint(val, 10, 64)
	return v
}

// parseMemInfoValue 从 /proc/meminfo 的单行中提取数值（kB）。
// 输入格式："MemTotal:  16384 kB"，返回 16384。
func parseMemInfoValue(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	v, _ := strconv.ParseUint(fields[1], 10, 64)
	return v
}

// formatDuration 将时间间隔格式化为人类可读的字符串。
// 格式规则：有天数时显示 "Xd Yh Zm"，有小时时显示 "Xh Ym"，否则显示 "Xm"。
func formatDuration(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	return fmt.Sprintf("%dm", minutes)
}
