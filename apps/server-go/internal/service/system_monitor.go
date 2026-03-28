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

// SystemMetrics holds all system metric categories.
type SystemMetrics struct {
	CPU     CPUMetrics     `json:"cpu"`
	Memory  MemoryMetrics  `json:"memory"`
	Disk    DiskMetrics    `json:"disk"`
	Network NetworkMetrics `json:"network"`
	Go      GoMetrics      `json:"go"`
}

type CPUMetrics struct {
	Cores       int     `json:"cores"`
	MaxProcs    int     `json:"maxProcs"`
	UsagePercent float64 `json:"usagePercent"`
}

type MemoryMetrics struct {
	TotalBytes     uint64  `json:"totalBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	FreeBytes      uint64  `json:"freeBytes"`
	UsagePercent   float64 `json:"usagePercent"`
	GoAllocBytes   uint64  `json:"goAllocBytes"`
	GoSysBytes     uint64  `json:"goSysBytes"`
	GoHeapAlloc    uint64  `json:"goHeapAlloc"`
	GoHeapSys      uint64  `json:"goHeapSys"`
	GoTotalAlloc   uint64  `json:"goTotalAlloc"`
}

type DiskMetrics struct {
	TotalBytes   uint64  `json:"totalBytes"`
	UsedBytes    uint64  `json:"usedBytes"`
	FreeBytes    uint64  `json:"freeBytes"`
	UsagePercent float64 `json:"usagePercent"`
	Path         string  `json:"path"`
}

type NetworkMetrics struct {
	BytesIn  int64 `json:"bytesIn"`
	BytesOut int64 `json:"bytesOut"`
}

type GoMetrics struct {
	Version      string `json:"version"`
	NumGoroutine int    `json:"numGoroutine"`
	NumGC        uint32 `json:"numGC"`
	Uptime       string `json:"uptime"`
	UptimeSeconds int64 `json:"uptimeSeconds"`
}

var startTime = time.Now()

// SystemMonitorService collects system-level metrics.
type SystemMonitorService struct {
	cfg *config.Config

	// Cached network counters for delta calculation
	mu             sync.Mutex
	lastNetIn      int64
	lastNetOut     int64
	lastNetCollect time.Time
}

func NewSystemMonitorService(cfg *config.Config) *SystemMonitorService {
	return &SystemMonitorService{cfg: cfg}
}

// CollectMetrics gathers all system metrics.
func (s *SystemMonitorService) CollectMetrics() SystemMetrics {
	var m SystemMetrics

	// CPU
	m.CPU.Cores = runtime.NumCPU()
	m.CPU.MaxProcs = runtime.GOMAXPROCS(0)
	m.CPU.UsagePercent = s.collectCPUUsage()

	// Memory
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	m.Memory.GoAllocBytes = ms.Alloc
	m.Memory.GoSysBytes = ms.Sys
	m.Memory.GoHeapAlloc = ms.HeapAlloc
	m.Memory.GoHeapSys = ms.HeapSys
	m.Memory.GoTotalAlloc = ms.TotalAlloc
	s.collectOSMemory(&m.Memory)

	// Disk
	m.Disk = s.collectDisk()

	// Network
	m.Network = s.collectNetwork()

	// Go runtime
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

func (s *SystemMonitorService) collectCPUUsage() float64 {
	if runtime.GOOS == "darwin" {
		out, err := exec.Command("top", "-l", "1", "-n", "0", "-stats", "cpu").Output()
		if err == nil {
			lines := strings.Split(string(out), "\n")
			for _, line := range lines {
				if strings.Contains(line, "CPU usage") {
					// "CPU usage: 5.26% user, 10.52% sys, 84.21% idle"
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
		// Read /proc/stat
		out, err := exec.Command("sh", "-c", "head -1 /proc/stat").Output()
		if err == nil {
			fields := strings.Fields(string(out))
			if len(fields) >= 5 {
				user, _ := strconv.ParseFloat(fields[1], 64)
				nice, _ := strconv.ParseFloat(fields[2], 64)
				system, _ := strconv.ParseFloat(fields[3], 64)
				idle, _ := strconv.ParseFloat(fields[4], 64)
				total := user + nice + system + idle
				if total > 0 {
					return (total - idle) / total * 100
				}
			}
		}
	}
	return 0
}

func (s *SystemMonitorService) collectOSMemory(m *MemoryMetrics) {
	if runtime.GOOS == "darwin" {
		// Get total memory
		out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
		if err == nil {
			total, e := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
			if e == nil {
				m.TotalBytes = total
			}
		}
		// Get used memory via vm_stat
		out, err = exec.Command("vm_stat").Output()
		if err == nil {
			pageSize := uint64(16384) // default on Apple Silicon
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

func (s *SystemMonitorService) collectNetwork() NetworkMetrics {
	var bytesIn, bytesOut int64

	if runtime.GOOS == "darwin" {
		out, err := exec.Command("netstat", "-ib").Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(out)))
			for scanner.Scan() {
				line := scanner.Text()
				fields := strings.Fields(line)
				// Look for en0 line with bytes
				if len(fields) >= 10 && strings.HasPrefix(fields[0], "en0") {
					// columns: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes
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

	return NetworkMetrics{BytesIn: bytesIn, BytesOut: bytesOut}
}

// StorageBreakdown returns storage usage for different subsystems.
type StorageBreakdown struct {
	Upload    StorageItem `json:"upload"`
	Database  StorageItem `json:"database"`
	Redis     StorageItem `json:"redis"`
	Logs      StorageItem `json:"logs"`
	Total     int64       `json:"total"`
}

type StorageItem struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Label string `json:"label"`
}

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

func parseMemInfoValue(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	v, _ := strconv.ParseUint(fields[1], 10, 64)
	return v
}

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
