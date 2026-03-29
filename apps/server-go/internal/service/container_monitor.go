package service

import (
	"context"
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

// ListContainers returns an overview of all aetherblog Docker containers.
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
		}

		overview.Containers = append(overview.Containers, info)
	}

	overview.TotalContainers = len(overview.Containers)
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
		if i+8 <= len(buf) {
			frameSize := int(buf[i+4])<<24 | int(buf[i+5])<<16 | int(buf[i+6])<<8 | int(buf[i+7])
			if frameSize > 0 && i+8+frameSize <= len(buf) {
				clean.Write(buf[i+8 : i+8+frameSize])
				i += 8 + frameSize
				continue
			}
		}
		clean.WriteByte(buf[i])
		i++
	}

	return clean.String(), nil
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
	case strings.Contains(name, "backend"):
		return "backend"
	case strings.Contains(name, "blog"):
		return "frontend"
	case strings.Contains(name, "admin"):
		return "frontend"
	case strings.Contains(name, "gateway") || strings.Contains(name, "nginx"):
		return "gateway"
	case strings.Contains(name, "ai"):
		return "ai"
	default:
		return "other"
	}
}
