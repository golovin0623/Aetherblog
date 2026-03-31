package service

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// validContainerID matches Docker container IDs and names.
var validContainerID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]+$`)

// ContainerOverview holds the summary of all Docker containers.
type ContainerOverview struct {
	Containers        []ContainerInfo `json:"containers"`
	TotalContainers   int             `json:"totalContainers"`
	RunningContainers int             `json:"runningContainers"`
	TotalMemoryUsed   int64           `json:"totalMemoryUsed"`
	TotalMemoryLimit  int64           `json:"totalMemoryLimit"`
	AvgCpuPercent     float64         `json:"avgCpuPercent"`
	DockerAvailable   bool            `json:"dockerAvailable"`
}

// ContainerInfo represents a single Docker container.
type ContainerInfo struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	DisplayName   string  `json:"displayName"`
	Status        string  `json:"status"`
	State         string  `json:"state"`
	CpuPercent    float64 `json:"cpuPercent"`
	MemoryUsed    int64   `json:"memoryUsed"`
	MemoryLimit   int64   `json:"memoryLimit"`
	MemoryPercent float64 `json:"memoryPercent"`
	Image         string  `json:"image"`
	Type          string  `json:"type"`
}

// ContainerMonitorService provides Docker container monitoring via Unix socket API.
type ContainerMonitorService struct {
	client *http.Client
}

// NewContainerMonitorService creates a ContainerMonitorService that connects to the Docker daemon via Unix socket.
func NewContainerMonitorService() *ContainerMonitorService {
	return &ContainerMonitorService{
		client: &http.Client{
			Transport: &http.Transport{
				DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
					return net.Dial("unix", "/var/run/docker.sock")
				},
			},
			Timeout: 5 * time.Second,
		},
	}
}

// dockerContainer is the JSON shape returned by Docker API /containers/json.
type dockerContainer struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	State  string            `json:"State"`
	Status string            `json:"Status"`
	Labels map[string]string `json:"Labels"`
}

// ListContainers returns an overview of all aetherblog Docker containers with live stats.
func (s *ContainerMonitorService) ListContainers() ContainerOverview {
	overview := ContainerOverview{
		Containers: []ContainerInfo{},
	}

	// Check if docker socket is available
	resp, err := s.client.Get("http://docker/containers/json?all=true&filters=" +
		`{"label":["com.docker.compose.project"]}`)
	if err != nil {
		// Try name-based filter as fallback
		resp, err = s.client.Get("http://docker/containers/json?all=true")
		if err != nil {
			return overview
		}
	}
	defer resp.Body.Close()
	overview.DockerAvailable = true

	var containers []dockerContainer
	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return overview
	}

	// Filter for aetherblog containers
	var infos []ContainerInfo
	for _, c := range containers {
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}

		// Only include aetherblog containers
		project := c.Labels["com.docker.compose.project"]
		if !strings.Contains(name, "aetherblog") && project != "aetherblog" {
			continue
		}

		info := ContainerInfo{
			ID:          c.ID[:12],
			Name:        name,
			DisplayName: inferDisplayName(name),
			Status:      c.Status,
			State:       c.State,
			Image:       c.Image,
			Type:        inferContainerType(name),
		}

		if c.State == "running" {
			overview.RunningContainers++
			// Fetch live stats for running containers
			s.fillContainerStats(c.ID, &info)
		}

		infos = append(infos, info)
	}

	// Compute totals
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
	return overview
}

// GetContainerLogs returns the last N lines of logs for a container.
func (s *ContainerMonitorService) GetContainerLogs(containerID string, tail int) (string, error) {
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

	// Docker log stream has 8-byte header per frame; strip it for plain text
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

	// Strip Docker stream headers (8 bytes per frame: [type(1)][0(3)][size(4)])
	var clean strings.Builder
	i := 0
	for i < len(buf) {
		if i+8 > len(buf) {
			break // incomplete header, discard remaining
		}
		frameSize := int(binary.BigEndian.Uint32(buf[i+4 : i+8]))
		if frameSize <= 0 || i+8+frameSize > len(buf) {
			break // incomplete or invalid frame, stop
		}
		clean.Write(buf[i+8 : i+8+frameSize])
		i += 8 + frameSize
	}

	return clean.String(), nil
}

// dockerStats is the JSON shape returned by Docker API /containers/{id}/stats?stream=false.
type dockerStats struct {
	CPUStats    dockerCPUStats    `json:"cpu_stats"`
	PreCPUStats dockerCPUStats    `json:"precpu_stats"`
	MemoryStats dockerMemoryStats `json:"memory_stats"`
}

type dockerCPUStats struct {
	CPUUsage    dockerCPUUsage `json:"cpu_usage"`
	SystemUsage uint64         `json:"system_cpu_usage"`
	OnlineCPUs  int            `json:"online_cpus"`
}

type dockerCPUUsage struct {
	TotalUsage uint64 `json:"total_usage"`
}

type dockerMemoryStats struct {
	Usage uint64 `json:"usage"`
	Limit uint64 `json:"limit"`
}

// fillContainerStats fetches live CPU/memory stats for a single container via Docker API.
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

	// CPU percent: delta(container usage) / delta(system usage) * num_cpus * 100
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage)
	cpus := stats.CPUStats.OnlineCPUs
	if cpus == 0 {
		cpus = 1
	}
	if sysDelta > 0 && cpuDelta >= 0 {
		info.CpuPercent = (cpuDelta / sysDelta) * float64(cpus) * 100.0
	}

	// Memory
	info.MemoryUsed = int64(stats.MemoryStats.Usage)
	info.MemoryLimit = int64(stats.MemoryStats.Limit)
	if stats.MemoryStats.Limit > 0 {
		info.MemoryPercent = float64(stats.MemoryStats.Usage) / float64(stats.MemoryStats.Limit) * 100.0
	}
}

func inferDisplayName(name string) string {
	name = strings.TrimPrefix(name, "aetherblog-")
	name = strings.TrimPrefix(name, "aetherblog_")
	parts := strings.Split(name, "-")
	if len(parts) > 0 {
		return parts[0]
	}
	return name
}

func inferContainerType(name string) string {
	switch {
	case strings.Contains(name, "postgres"):
		return "database"
	case strings.Contains(name, "redis"):
		return "cache"
	case strings.Contains(name, "elasticsearch") || strings.Contains(name, "elastic"):
		return "search"
	case strings.Contains(name, "backend"):
		return "java"
	case strings.Contains(name, "blog"):
		return "nodejs"
	case strings.Contains(name, "admin") || strings.Contains(name, "gateway") || strings.Contains(name, "nginx"):
		return "nginx"
	case strings.Contains(name, "ai"):
		return "ai"
	default:
		return "other"
	}
}
