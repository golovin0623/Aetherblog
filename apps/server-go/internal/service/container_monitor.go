package service

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
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

// ContainerMonitorService provides Docker container monitoring via CLI.
type ContainerMonitorService struct{}

func NewContainerMonitorService() *ContainerMonitorService {
	return &ContainerMonitorService{}
}

// ListContainers returns an overview of all aetherblog Docker containers.
func (s *ContainerMonitorService) ListContainers() ContainerOverview {
	overview := ContainerOverview{
		Containers: []ContainerInfo{},
	}

	// Check if docker is available
	if _, err := exec.LookPath("docker"); err != nil {
		return overview
	}
	overview.DockerAvailable = true

	// List containers with aetherblog compose project
	out, err := exec.Command("docker", "ps", "-a",
		"--filter", "label=com.docker.compose.project=aetherblog",
		"--format", "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}|{{.State}}",
	).Output()
	if err != nil {
		// Try without filter for standalone containers
		out, err = exec.Command("docker", "ps", "-a",
			"--filter", "name=aetherblog",
			"--format", "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}|{{.State}}",
		).Output()
		if err != nil {
			return overview
		}
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 0 || (len(lines) == 1 && lines[0] == "") {
		return overview
	}

	var ids []string
	containerMap := make(map[string]*ContainerInfo)

	for _, line := range lines {
		parts := strings.SplitN(line, "|", 5)
		if len(parts) < 5 {
			continue
		}
		id := parts[0]
		name := parts[1]
		status := parts[2]
		image := parts[3]
		state := parts[4]

		info := &ContainerInfo{
			ID:          id,
			Name:        name,
			DisplayName: inferDisplayName(name),
			Status:      status,
			State:       state,
			Image:       image,
			Type:        inferContainerType(name, image),
		}
		containerMap[id] = info
		ids = append(ids, id)
		overview.TotalContainers++
		if strings.ToLower(state) == "running" {
			overview.RunningContainers++
		}
	}

	// Get stats for running containers
	if len(ids) > 0 {
		args := append([]string{"stats", "--no-stream", "--format", "{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}"}, ids...)
		statsOut, err := exec.Command("docker", args...).Output()
		if err == nil {
			statsLines := strings.Split(strings.TrimSpace(string(statsOut)), "\n")
			for _, sl := range statsLines {
				parts := strings.SplitN(sl, "|", 4)
				if len(parts) < 4 {
					continue
				}
				id := parts[0]
				info, ok := containerMap[id]
				if !ok {
					continue
				}

				// CPU: "0.50%"
				cpuStr := strings.TrimSuffix(strings.TrimSpace(parts[1]), "%")
				info.CpuPercent, _ = strconv.ParseFloat(cpuStr, 64)

				// Memory: "50.5MiB / 1GiB"
				memParts := strings.Split(parts[2], "/")
				if len(memParts) == 2 {
					info.MemoryUsed = parseMemoryString(strings.TrimSpace(memParts[0]))
					info.MemoryLimit = parseMemoryString(strings.TrimSpace(memParts[1]))
				}

				// Mem%: "5.00%"
				memPctStr := strings.TrimSuffix(strings.TrimSpace(parts[3]), "%")
				info.MemoryPercent, _ = strconv.ParseFloat(memPctStr, 64)
			}
		}
	}

	var totalCpu float64
	for _, id := range ids {
		info := containerMap[id]
		overview.Containers = append(overview.Containers, *info)
		overview.TotalMemoryUsed += info.MemoryUsed
		overview.TotalMemoryLimit += info.MemoryLimit
		totalCpu += info.CpuPercent
	}
	if overview.RunningContainers > 0 {
		overview.AvgCpuPercent = totalCpu / float64(overview.RunningContainers)
	}

	return overview
}

// GetContainerLogs retrieves logs for a specific container.
func (s *ContainerMonitorService) GetContainerLogs(containerID string, tail int) (string, error) {
	if containerID == "" || !validContainerID.MatchString(containerID) || strings.HasPrefix(containerID, "-") {
		return "", fmt.Errorf("invalid container ID: %s", containerID)
	}
	if tail <= 0 {
		tail = 200
	}
	out, err := exec.Command("docker", "logs", "--tail", fmt.Sprintf("%d", tail), containerID).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to get logs for container %s: %w", containerID, err)
	}
	return string(out), nil
}

func inferDisplayName(name string) string {
	// Remove common prefixes
	name = strings.TrimPrefix(name, "aetherblog-")
	name = strings.TrimPrefix(name, "aetherblog_")
	// Capitalize first letter
	if len(name) > 0 {
		return strings.ToUpper(name[:1]) + name[1:]
	}
	return name
}

func inferContainerType(name, image string) string {
	lower := strings.ToLower(name + " " + image)
	switch {
	case strings.Contains(lower, "postgres"):
		return "database"
	case strings.Contains(lower, "redis"):
		return "cache"
	case strings.Contains(lower, "elasticsearch") || strings.Contains(lower, "elastic"):
		return "search"
	case strings.Contains(lower, "nginx") || strings.Contains(lower, "gateway"):
		return "gateway"
	case strings.Contains(lower, "blog"):
		return "frontend"
	case strings.Contains(lower, "admin"):
		return "frontend"
	case strings.Contains(lower, "server") || strings.Contains(lower, "backend") || strings.Contains(lower, "api"):
		return "backend"
	case strings.Contains(lower, "ai"):
		return "ai"
	default:
		return "other"
	}
}

func parseMemoryString(s string) int64 {
	s = strings.TrimSpace(s)
	multiplier := int64(1)
	switch {
	case strings.HasSuffix(s, "GiB"):
		multiplier = 1024 * 1024 * 1024
		s = strings.TrimSuffix(s, "GiB")
	case strings.HasSuffix(s, "MiB"):
		multiplier = 1024 * 1024
		s = strings.TrimSuffix(s, "MiB")
	case strings.HasSuffix(s, "KiB"):
		multiplier = 1024
		s = strings.TrimSuffix(s, "KiB")
	case strings.HasSuffix(s, "B"):
		s = strings.TrimSuffix(s, "B")
	}
	val, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return int64(val * float64(multiplier))
}
