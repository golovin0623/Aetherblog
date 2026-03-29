package service

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// MetricSnapshot holds a single point-in-time measurement.
type MetricSnapshot struct {
	Timestamp  time.Time `json:"timestamp"`
	CPU        float64   `json:"cpu"`
	Memory     float64   `json:"memory"`
	Disk       float64   `json:"disk"`
	NetworkIn  int64     `json:"networkIn"`
	NetworkOut int64     `json:"networkOut"`
}

// TimeValue is a generic time-series data point.
type TimeValue struct {
	Time  time.Time `json:"time"`
	Value float64   `json:"value"`
}

// NetworkTimeValue holds network I/O at a point in time.
type NetworkTimeValue struct {
	Time time.Time `json:"time"`
	In   int64     `json:"in"`
	Out  int64     `json:"out"`
}

// MetricHistory contains downsampled time-series data.
type MetricHistory struct {
	CPU         []TimeValue        `json:"cpu"`
	Memory      []TimeValue        `json:"memory"`
	Disk        []TimeValue        `json:"disk"`
	Network     []NetworkTimeValue `json:"network"`
	TotalPoints int                `json:"totalPoints"`
	StartTime   time.Time          `json:"startTime"`
	EndTime     time.Time          `json:"endTime"`
}

// HistoryStats contains summary statistics over the collected history.
type HistoryStats struct {
	TotalPoints           int    `json:"totalPoints"`
	EstimatedSizeBytes    int    `json:"estimatedSizeBytes"`
	RetentionMinutes      int    `json:"retentionMinutes"`
	SampleIntervalSeconds int    `json:"sampleIntervalSeconds"`
	OldestTimestamp       string `json:"oldestTimestamp"`
	NewestTimestamp       string `json:"newestTimestamp"`
}

// Alert represents a threshold violation.
type Alert struct {
	Metric       string    `json:"metric"`
	Level        string    `json:"level"`
	CurrentValue float64   `json:"currentValue"`
	Threshold    float64   `json:"threshold"`
	TriggeredAt  time.Time `json:"triggeredAt"`
	Message      string    `json:"message"`
}

// MonitorConfig represents the monitoring configuration returned by the config endpoint.
type MonitorConfig struct {
	AlertConfig    AlertConfig `json:"alertConfig"`
	RefreshOptions []int       `json:"refreshOptions"`
	HistoryDataSize int        `json:"historyDataSize"`
}

// AlertConfig defines alert thresholds and collection settings.
type AlertConfig struct {
	CPUThreshold          float64 `json:"cpuThreshold"`
	MemoryThreshold       float64 `json:"memoryThreshold"`
	DiskThreshold         float64 `json:"diskThreshold"`
	SustainedCount        int     `json:"sustainedCount"`
	RetentionMinutes      int     `json:"retentionMinutes"`
	SampleIntervalSeconds int     `json:"sampleIntervalSeconds"`
}

const (
	collectInterval = 30 * time.Second
	retentionPeriod = 24 * time.Hour
	cpuThreshold    = 80.0
	memThreshold    = 85.0
	diskThreshold   = 90.0
	sustainedCount  = 5
)

// MetricsHistoryService collects and stores metric snapshots in memory.
type MetricsHistoryService struct {
	monitor *SystemMonitorService

	mu        sync.RWMutex
	snapshots []MetricSnapshot

	// Alert tracking
	alertMu       sync.RWMutex
	alerts        []Alert
	cpuViolations int
	memViolations int
	diskViolations int
}

func NewMetricsHistoryService(monitor *SystemMonitorService) *MetricsHistoryService {
	return &MetricsHistoryService{
		monitor:   monitor,
		snapshots: make([]MetricSnapshot, 0, 2880), // 24h * 120 per hour
	}
}

// Start begins the background collection goroutine.
func (s *MetricsHistoryService) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(collectInterval)
		defer ticker.Stop()

		// Collect immediately on start
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
	log.Info().Msg("metrics history collection started (interval: 30s, retention: 24h)")
}

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
	// Trim old entries
	cutoff := time.Now().Add(-retentionPeriod)
	trimIdx := 0
	for trimIdx < len(s.snapshots) && !s.snapshots[trimIdx].Timestamp.After(cutoff) {
		trimIdx++
	}
	s.snapshots = s.snapshots[trimIdx:]
	s.mu.Unlock()

	// Check alerts
	s.checkAlerts(snapshot)
}

func (s *MetricsHistoryService) checkAlerts(snap MetricSnapshot) {
	s.alertMu.Lock()
	defer s.alertMu.Unlock()

	// CPU
	if snap.CPU > cpuThreshold {
		s.cpuViolations++
	} else {
		s.cpuViolations = 0
	}
	if s.cpuViolations >= sustainedCount {
		s.addAlert("cpu", "warning", snap.CPU, cpuThreshold, "CPU usage sustained above threshold")
	}

	// Memory
	if snap.Memory > memThreshold {
		s.memViolations++
	} else {
		s.memViolations = 0
	}
	if s.memViolations >= sustainedCount {
		s.addAlert("memory", "warning", snap.Memory, memThreshold, "Memory usage sustained above threshold")
	}

	// Disk
	if snap.Disk > diskThreshold {
		s.diskViolations++
	} else {
		s.diskViolations = 0
	}
	if s.diskViolations >= sustainedCount {
		s.addAlert("disk", "critical", snap.Disk, diskThreshold, "Disk usage sustained above threshold")
	}
}

func (s *MetricsHistoryService) addAlert(metric, level string, current, threshold float64, msg string) {
	// Avoid duplicate active alerts for the same metric
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
	// Keep only recent alerts (last 100)
	if len(s.alerts) > 100 {
		s.alerts = s.alerts[len(s.alerts)-100:]
	}
}

// GetHistory returns downsampled metric history for the given time range.
func (s *MetricsHistoryService) GetHistory(minutes int, maxPoints int) MetricHistory {
	if minutes <= 0 {
		minutes = 60
	}
	if maxPoints <= 0 {
		maxPoints = 120
	}

	cutoff := time.Now().Add(-time.Duration(minutes) * time.Minute)

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

	// Downsample if needed
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

// GetStats returns aggregate statistics over the collected history.
func (s *MetricsHistoryService) GetStats() HistoryStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	const estimatedBytesPerPoint = 60 // rough estimate per snapshot

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

// CleanHistory removes all collected snapshots.
func (s *MetricsHistoryService) CleanHistory() int {
	s.mu.Lock()
	count := len(s.snapshots)
	s.snapshots = s.snapshots[:0]
	s.mu.Unlock()

	s.alertMu.Lock()
	s.cpuViolations = 0
	s.memViolations = 0
	s.diskViolations = 0
	s.alertMu.Unlock()

	return count
}

// GetAlerts returns active alerts.
func (s *MetricsHistoryService) GetAlerts() []Alert {
	s.alertMu.RLock()
	defer s.alertMu.RUnlock()

	// Return alerts from the last hour
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

// GetConfig returns the current monitoring configuration.
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

// downsample reduces the number of snapshots by averaging within buckets.
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
