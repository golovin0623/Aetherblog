package service

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// MetricSnapshot 保存某一时刻的系统指标快照。
type MetricSnapshot struct {
	Timestamp  time.Time `json:"timestamp"`
	CPU        float64   `json:"cpu"`
	Memory     float64   `json:"memory"`
	Disk       float64   `json:"disk"`
	NetworkIn  int64     `json:"networkIn"`
	NetworkOut int64     `json:"networkOut"`
}

// TimeValue 是通用的时间序列数据点，包含时间戳和对应值。
type TimeValue struct {
	Time  time.Time `json:"time"`
	Value float64   `json:"value"`
}

// NetworkTimeValue 保存某一时刻的网络入/出流量数据。
type NetworkTimeValue struct {
	Time time.Time `json:"time"`
	In   int64     `json:"in"`
	Out  int64     `json:"out"`
}

// MetricHistory 包含经过降采样处理的时间序列指标数据。
type MetricHistory struct {
	CPU         []TimeValue        `json:"cpu"`
	Memory      []TimeValue        `json:"memory"`
	Disk        []TimeValue        `json:"disk"`
	Network     []NetworkTimeValue `json:"network"`
	TotalPoints int                `json:"totalPoints"`
	StartTime   time.Time          `json:"startTime"`
	EndTime     time.Time          `json:"endTime"`
}

// HistoryStats 包含对已收集历史数据的汇总统计信息。
type HistoryStats struct {
	TotalPoints           int    `json:"totalPoints"`
	EstimatedSizeBytes    int    `json:"estimatedSizeBytes"`
	RetentionMinutes      int    `json:"retentionMinutes"`
	SampleIntervalSeconds int    `json:"sampleIntervalSeconds"`
	OldestTimestamp       string `json:"oldestTimestamp"`
	NewestTimestamp       string `json:"newestTimestamp"`
}

// Alert 表示某项指标超出阈值时产生的告警记录。
type Alert struct {
	Metric       string    `json:"metric"`
	Level        string    `json:"level"`
	CurrentValue float64   `json:"currentValue"`
	Threshold    float64   `json:"threshold"`
	TriggeredAt  time.Time `json:"triggeredAt"`
	Message      string    `json:"message"`
}

// MonitorConfig 表示监控配置接口返回的完整配置信息。
type MonitorConfig struct {
	AlertConfig     AlertConfig `json:"alertConfig"`
	RefreshOptions  []int       `json:"refreshOptions"`
	HistoryDataSize int         `json:"historyDataSize"`
}

// AlertConfig 定义各指标的告警阈值及数据采集配置。
type AlertConfig struct {
	CPUThreshold          float64 `json:"cpuThreshold"`
	MemoryThreshold       float64 `json:"memoryThreshold"`
	DiskThreshold         float64 `json:"diskThreshold"`
	SustainedCount        int     `json:"sustainedCount"`
	RetentionMinutes      int     `json:"retentionMinutes"`
	SampleIntervalSeconds int     `json:"sampleIntervalSeconds"`
}

const (
	// collectInterval 是指标采集的时间间隔（30 秒）。
	collectInterval = 30 * time.Second
	// retentionPeriod 是历史数据的保留时长（24 小时）。
	retentionPeriod = 24 * time.Hour
	// cpuThreshold 是 CPU 使用率告警阈值（百分比）。
	cpuThreshold = 80.0
	// memThreshold 是内存使用率告警阈值（百分比）。
	memThreshold = 85.0
	// diskThreshold 是磁盘使用率告警阈值（百分比）。
	diskThreshold = 90.0
	// sustainedCount 是触发告警所需的连续超阈值次数。
	sustainedCount = 5
)

// MetricsHistoryService 在内存中采集并存储系统指标快照。
// 数据保留周期为 24 小时，采集间隔为 30 秒。
type MetricsHistoryService struct {
	monitor *SystemMonitorService

	mu        sync.RWMutex
	snapshots []MetricSnapshot

	// 告警追踪：记录各指标的连续违规次数和已触发告警列表
	alertMu        sync.RWMutex
	alerts         []Alert
	cpuViolations  int
	memViolations  int
	diskViolations int
}

// NewMetricsHistoryService 创建一个由给定监控服务支持的 MetricsHistoryService 实例。
// 需要调用 Start 方法才会开始后台数据采集。
func NewMetricsHistoryService(monitor *SystemMonitorService) *MetricsHistoryService {
	return &MetricsHistoryService{
		monitor:   monitor,
		snapshots: make([]MetricSnapshot, 0, 2880), // 24h * 每小时 120 个采样点
	}
}

// Start 启动后台采集协程，按照 collectInterval 定期采集系统指标。
// 采集协程会在 ctx 取消时退出。
func (s *MetricsHistoryService) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(collectInterval)
		defer ticker.Stop()

		// 启动时立即采集一次，避免等待第一个周期
		s.collect()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.collect()
			}
		}
	}()
	log.Info().Msg("指标历史采集已启动（间隔: 30s，保留: 24h）")
}

// collect 采集一次系统指标并追加到快照列表，同时清除超出保留期的旧数据。
func (s *MetricsHistoryService) collect() {
	metrics := s.monitor.CollectMetrics()

	snapshot := MetricSnapshot{
		Timestamp:  time.Now(),
		CPU:        metrics.CPU.UsagePercent,
		Memory:     metrics.Memory.UsagePercent,
		Disk:       metrics.Disk.UsagePercent,
		NetworkIn:  metrics.Network.BytesIn,
		NetworkOut: metrics.Network.BytesOut,
	}

	s.mu.Lock()
	s.snapshots = append(s.snapshots, snapshot)
	// 删除超出保留期的旧快照
	cutoff := time.Now().Add(-retentionPeriod)
	trimIdx := 0
	for trimIdx < len(s.snapshots) && !s.snapshots[trimIdx].Timestamp.After(cutoff) {
		trimIdx++
	}
	s.snapshots = s.snapshots[trimIdx:]
	s.mu.Unlock()

	// 检查是否触发告警
	s.checkAlerts(snapshot)
}

// checkAlerts 检查快照中各指标是否持续超出阈值，持续超阈值达到 sustainedCount 次则触发告警。
func (s *MetricsHistoryService) checkAlerts(snap MetricSnapshot) {
	s.alertMu.Lock()
	defer s.alertMu.Unlock()

	// 检查 CPU 使用率
	if snap.CPU > cpuThreshold {
		s.cpuViolations++
	} else {
		s.cpuViolations = 0
	}
	if s.cpuViolations >= sustainedCount {
		s.addAlert("cpu", "warning", snap.CPU, cpuThreshold, "CPU 使用率持续超过阈值")
	}

	// 检查内存使用率
	if snap.Memory > memThreshold {
		s.memViolations++
	} else {
		s.memViolations = 0
	}
	if s.memViolations >= sustainedCount {
		s.addAlert("memory", "warning", snap.Memory, memThreshold, "内存使用率持续超过阈值")
	}

	// 检查磁盘使用率
	if snap.Disk > diskThreshold {
		s.diskViolations++
	} else {
		s.diskViolations = 0
	}
	if s.diskViolations >= sustainedCount {
		s.addAlert("disk", "critical", snap.Disk, diskThreshold, "磁盘使用率持续超过阈值")
	}
}

// addAlert 向告警列表中追加一条新告警。
// 若同一指标在 5 分钟内已有活跃告警，则跳过，避免重复告警。
// 告警列表最多保留最近 100 条。
func (s *MetricsHistoryService) addAlert(metric, level string, current, threshold float64, msg string) {
	// 5 分钟内同指标已有告警，不重复添加
	for _, a := range s.alerts {
		if a.Metric == metric && time.Since(a.TriggeredAt) < 5*time.Minute {
			return
		}
	}
	s.alerts = append(s.alerts, Alert{
		Metric:       metric,
		Level:        level,
		CurrentValue: current,
		Threshold:    threshold,
		TriggeredAt:  time.Now(),
		Message:      msg,
	})
	// 只保留最近 100 条告警
	if len(s.alerts) > 100 {
		s.alerts = s.alerts[len(s.alerts)-100:]
	}
}

// GetHistory 返回指定时间范围内经过降采样的指标历史数据。
// minutes 指定回溯分钟数，maxPoints 指定最大数据点数，两者均 <= 0 时使用默认值。
func (s *MetricsHistoryService) GetHistory(minutes int, maxPoints int) MetricHistory {
	if minutes <= 0 {
		minutes = 60
	}
	if maxPoints <= 0 {
		maxPoints = 120
	}

	cutoff := time.Now().Add(-time.Duration(minutes) * time.Minute)

	// 筛选出指定时间范围内的快照
	s.mu.RLock()
	var filtered []MetricSnapshot
	for _, snap := range s.snapshots {
		if snap.Timestamp.After(cutoff) {
			filtered = append(filtered, snap)
		}
	}
	s.mu.RUnlock()

	if len(filtered) == 0 {
		return MetricHistory{
			CPU:     []TimeValue{},
			Memory:  []TimeValue{},
			Disk:    []TimeValue{},
			Network: []NetworkTimeValue{},
		}
	}

	// 数据点超过上限时进行降采样
	if len(filtered) > maxPoints {
		filtered = downsample(filtered, maxPoints)
	}

	history := MetricHistory{
		CPU:         make([]TimeValue, len(filtered)),
		Memory:      make([]TimeValue, len(filtered)),
		Disk:        make([]TimeValue, len(filtered)),
		Network:     make([]NetworkTimeValue, len(filtered)),
		TotalPoints: len(filtered),
		StartTime:   filtered[0].Timestamp,
		EndTime:     filtered[len(filtered)-1].Timestamp,
	}

	for i, snap := range filtered {
		history.CPU[i] = TimeValue{Time: snap.Timestamp, Value: snap.CPU}
		history.Memory[i] = TimeValue{Time: snap.Timestamp, Value: snap.Memory}
		history.Disk[i] = TimeValue{Time: snap.Timestamp, Value: snap.Disk}
		history.Network[i] = NetworkTimeValue{
			Time: snap.Timestamp,
			In:   snap.NetworkIn,
			Out:  snap.NetworkOut,
		}
	}

	return history
}

// GetStats 返回对已收集历史数据的聚合统计信息，包括数据点数量、估算内存占用等。
func (s *MetricsHistoryService) GetStats() HistoryStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	const estimatedBytesPerPoint = 60 // 每个快照的估算字节数

	stats := HistoryStats{
		TotalPoints:           len(s.snapshots),
		EstimatedSizeBytes:    len(s.snapshots) * estimatedBytesPerPoint,
		RetentionMinutes:      int(retentionPeriod.Minutes()),
		SampleIntervalSeconds: int(collectInterval.Seconds()),
	}

	if len(s.snapshots) == 0 {
		return stats
	}

	stats.OldestTimestamp = s.snapshots[0].Timestamp.Format("2006-01-02T15:04:05")
	stats.NewestTimestamp = s.snapshots[len(s.snapshots)-1].Timestamp.Format("2006-01-02T15:04:05")

	return stats
}

// CleanHistory 清除所有已收集的快照数据，同时重置各指标的违规计数。
// 返回被清除的快照数量。
func (s *MetricsHistoryService) CleanHistory() int {
	s.mu.Lock()
	count := len(s.snapshots)
	s.snapshots = s.snapshots[:0]
	s.mu.Unlock()

	// 重置违规计数
	s.alertMu.Lock()
	s.cpuViolations = 0
	s.memViolations = 0
	s.diskViolations = 0
	s.alertMu.Unlock()

	return count
}

// GetAlerts 返回最近一小时内触发的活跃告警列表。
func (s *MetricsHistoryService) GetAlerts() []Alert {
	s.alertMu.RLock()
	defer s.alertMu.RUnlock()

	// 只返回最近一小时内的告警
	cutoff := time.Now().Add(-1 * time.Hour)
	var active []Alert
	for _, a := range s.alerts {
		if a.TriggeredAt.After(cutoff) {
			active = append(active, a)
		}
	}
	if active == nil {
		active = []Alert{}
	}
	return active
}

// GetConfig 返回当前监控系统的完整配置信息，包括阈值、采集间隔和当前数据量。
func (s *MetricsHistoryService) GetConfig() MonitorConfig {
	s.mu.RLock()
	dataSize := len(s.snapshots)
	s.mu.RUnlock()

	return MonitorConfig{
		AlertConfig: AlertConfig{
			CPUThreshold:          cpuThreshold,
			MemoryThreshold:       memThreshold,
			DiskThreshold:         diskThreshold,
			SustainedCount:        sustainedCount,
			RetentionMinutes:      int(retentionPeriod.Minutes()),
			SampleIntervalSeconds: int(collectInterval.Seconds()),
		},
		RefreshOptions:  []int{5, 10, 30, 60, 300},
		HistoryDataSize: dataSize,
	}
}

// downsample 通过桶内平均的方式将快照列表降采样至 maxPoints 个数据点。
// 每个桶使用中间时间戳作为代表时间，其余指标取桶内均值。
func downsample(data []MetricSnapshot, maxPoints int) []MetricSnapshot {
	if len(data) <= maxPoints {
		return data
	}
	bucketSize := len(data) / maxPoints
	if bucketSize < 1 {
		bucketSize = 1
	}

	result := make([]MetricSnapshot, 0, maxPoints)
	for i := 0; i < len(data); i += bucketSize {
		end := i + bucketSize
		if end > len(data) {
			end = len(data)
		}
		bucket := data[i:end]
		// 以桶中间位置的时间戳作为该数据点的时间
		avg := MetricSnapshot{
			Timestamp: bucket[len(bucket)/2].Timestamp,
		}
		for _, s := range bucket {
			avg.CPU += s.CPU
			avg.Memory += s.Memory
			avg.Disk += s.Disk
			avg.NetworkIn += s.NetworkIn
			avg.NetworkOut += s.NetworkOut
		}
		n := float64(len(bucket))
		avg.CPU /= n
		avg.Memory /= n
		avg.Disk /= n
		avg.NetworkIn = int64(float64(avg.NetworkIn) / n)
		avg.NetworkOut = int64(float64(avg.NetworkOut) / n)
		result = append(result, avg)
	}
	return result
}
