package service

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/config"
)

// LogReadResult contains the result of reading log lines.
type LogReadResult struct {
	Lines      []string `json:"lines"`
	Cursor     string   `json:"cursor"`
	NextCursor *string  `json:"nextCursor"`
}

// LogFileInfo describes an available log file.
type LogFileInfo struct {
	Level         string    `json:"level"`
	Filename      string    `json:"filename"`
	Size          int64     `json:"size"`
	SizeFormatted string    `json:"sizeFormatted"`
	Exists        bool      `json:"exists"`
	Modified      time.Time `json:"modified"`
}

// serviceLogFile maps a logical name to a log file.
type serviceLogFile struct {
	Service  string // display name for the frontend filter dropdown
	Filename string // file in the log directory
}

// LogViewerService reads application log files from all services.
type LogViewerService struct {
	cfg *config.Config
}

func NewLogViewerService(cfg *config.Config) *LogViewerService {
	return &LogViewerService{cfg: cfg}
}

// serviceFiles defines all service log files to aggregate.
var serviceFiles = []serviceLogFile{
	{Service: "backend", Filename: "backend.log"},
	{Service: "ai-service", Filename: "ai-service.log"},
}

// logFileMap maps level/filter names to log files for backward compatibility.
var logFileMap = map[string]string{
	"ALL":     "",              // triggers multi-file aggregation
	"BACKEND": "backend.log",  // single-service filter
	"AI":      "ai-service.log",
}

// ListLogFiles returns information about available log files.
func (s *LogViewerService) ListLogFiles() []LogFileInfo {
	var files []LogFileInfo
	logDir := s.cfg.Log.Path

	for _, sf := range serviceFiles {
		path := filepath.Join(logDir, sf.Filename)
		info, err := os.Stat(path)
		if err != nil {
			files = append(files, LogFileInfo{
				Level:         strings.ToUpper(sf.Service),
				Filename:      sf.Filename,
				Size:          0,
				SizeFormatted: "0 B",
				Exists:        false,
			})
			continue
		}
		files = append(files, LogFileInfo{
			Level:         strings.ToUpper(sf.Service),
			Filename:      sf.Filename,
			Size:          info.Size(),
			SizeFormatted: formatFileSize(info.Size()),
			Exists:        true,
			Modified:      info.ModTime(),
		})
	}

	// Also add an "ALL" entry with combined size
	var totalSize int64
	var anyExists bool
	var latestMod time.Time
	for _, f := range files {
		totalSize += f.Size
		if f.Exists {
			anyExists = true
			if f.Modified.After(latestMod) {
				latestMod = f.Modified
			}
		}
	}
	allEntry := LogFileInfo{
		Level:         "ALL",
		Filename:      "(all services)",
		Size:          totalSize,
		SizeFormatted: formatFileSize(totalSize),
		Exists:        anyExists,
		Modified:      latestMod,
	}
	files = append([]LogFileInfo{allEntry}, files...)

	return files
}

// ReadLogs reads log lines, supporting multi-file aggregation.
// level: "ALL" aggregates all services; "BACKEND"/"AI" reads one file.
// JSON lines are parsed for level filtering; keyword search is on the raw line.
func (s *LogViewerService) ReadLogs(level string, limit int, keyword string, cursor string) (*LogReadResult, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 2000 {
		limit = 2000
	}

	level = strings.ToUpper(level)
	if level == "" {
		level = "ALL"
	}

	logDir := s.cfg.Log.Path

	if level == "ALL" {
		return s.readAggregated(logDir, limit, keyword, "", cursor)
	}

	// Level-based filtering across all files (INFO, WARN, ERROR, DEBUG)
	if level == "INFO" || level == "WARN" || level == "ERROR" || level == "DEBUG" {
		return s.readAggregated(logDir, limit, keyword, strings.ToLower(level), cursor)
	}

	// Single service file
	fileName, ok := logFileMap[level]
	if !ok {
		return s.readAggregated(logDir, limit, keyword, "", cursor)
	}

	return s.readSingleFile(filepath.Join(logDir, fileName), limit, keyword, cursor)
}

// readAggregated reads from all service log files, filters, and merge-sorts by timestamp.
func (s *LogViewerService) readAggregated(logDir string, limit int, keyword string, levelFilter string, cursor string) (*LogReadResult, error) {
	// Parse multi-file cursor: base64(json({"backend":offset,"ai-service":offset}))
	offsets := parseMultiCursor(cursor)

	type logEntry struct {
		raw       string
		timestamp time.Time
		source    string
	}

	var allEntries []logEntry

	for _, sf := range serviceFiles {
		filePath := filepath.Join(logDir, sf.Filename)
		f, err := os.Open(filePath)
		if err != nil {
			continue // file doesn't exist, skip
		}

		info, err := f.Stat()
		if err != nil {
			f.Close()
			continue
		}

		offset := offsets[sf.Service]
		if offset <= 0 {
			offset = info.Size()
		}

		lines, _ := readTailLines(f, offset, limit*2, "") // read more than needed for merging
		f.Close()

		for _, line := range lines {
			if keyword != "" && !strings.Contains(strings.ToLower(line), strings.ToLower(keyword)) {
				continue
			}

			// Parse JSON to extract timestamp and level
			var entry map[string]interface{}
			ts := time.Now() // fallback
			entryLevel := ""
			if json.Unmarshal([]byte(line), &entry) == nil {
				if t, ok := entry["timestamp"].(string); ok {
					if parsed, err := time.Parse(time.RFC3339Nano, t); err == nil {
						ts = parsed
					}
				}
				if l, ok := entry["level"].(string); ok {
					entryLevel = strings.ToLower(l)
				}
			}

			// Apply level filter
			if levelFilter != "" && entryLevel != levelFilter {
				continue
			}

			allEntries = append(allEntries, logEntry{raw: line, timestamp: ts, source: sf.Service})
		}
	}

	// Sort by timestamp ascending (oldest first, newest at bottom)
	sort.Slice(allEntries, func(i, j int) bool {
		return allEntries[i].timestamp.Before(allEntries[j].timestamp)
	})

	// Take the last `limit` entries
	if len(allEntries) > limit {
		allEntries = allEntries[len(allEntries)-limit:]
	}

	result := make([]string, len(allEntries))
	for i, e := range allEntries {
		result[i] = e.raw
	}

	return &LogReadResult{
		Lines:  result,
		Cursor: cursor,
	}, nil
}

// readSingleFile reads from a single log file (backward compat).
func (s *LogViewerService) readSingleFile(logPath string, limit int, keyword string, cursor string) (*LogReadResult, error) {
	f, err := os.Open(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &LogReadResult{Lines: []string{}}, nil
		}
		return nil, fmt.Errorf("open log file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat log file: %w", err)
	}

	var offset int64
	if cursor != "" {
		decoded, err := base64.StdEncoding.DecodeString(cursor)
		if err == nil {
			offset, _ = strconv.ParseInt(string(decoded), 10, 64)
		}
	}
	if offset <= 0 {
		offset = info.Size()
	}

	lines, newOffset := readTailLines(f, offset, limit, keyword)

	result := &LogReadResult{
		Lines:  lines,
		Cursor: encodeCursor(offset),
	}

	if newOffset > 0 {
		nc := encodeCursor(newOffset)
		result.NextCursor = &nc
	}

	return result, nil
}

// GetLogFilePath returns the file path for downloading a log file.
func (s *LogViewerService) GetLogFilePath(level string) (string, error) {
	level = strings.ToUpper(level)
	if level == "" {
		level = "ALL"
	}

	// For ALL, return the largest log file
	if level == "ALL" {
		logDir := s.cfg.Log.Path
		var bestPath string
		var bestSize int64
		for _, sf := range serviceFiles {
			p := filepath.Join(logDir, sf.Filename)
			if info, err := os.Stat(p); err == nil && info.Size() > bestSize {
				bestPath = p
				bestSize = info.Size()
			}
		}
		if bestPath == "" {
			return "", fmt.Errorf("no log files found")
		}
		return bestPath, nil
	}

	fileName, ok := logFileMap[level]
	if !ok {
		return "", fmt.Errorf("unknown log level: %s", level)
	}

	logPath := filepath.Join(s.cfg.Log.Path, fileName)
	if _, err := os.Stat(logPath); err != nil {
		return "", fmt.Errorf("log file not found: %s", fileName)
	}

	return logPath, nil
}

// parseMultiCursor decodes a multi-file cursor (base64 JSON map).
func parseMultiCursor(cursor string) map[string]int64 {
	if cursor == "" {
		return map[string]int64{}
	}
	decoded, err := base64.StdEncoding.DecodeString(cursor)
	if err != nil {
		return map[string]int64{}
	}
	var offsets map[string]int64
	if json.Unmarshal(decoded, &offsets) != nil {
		// Try legacy single-offset format
		if n, err := strconv.ParseInt(string(decoded), 10, 64); err == nil {
			return map[string]int64{"backend": n}
		}
		return map[string]int64{}
	}
	return offsets
}

// readTailLines reads the last N lines from a file ending at the given offset.
func readTailLines(f *os.File, endOffset int64, limit int, keyword string) ([]string, int64) {
	if endOffset <= 0 {
		return []string{}, 0
	}

	chunkSize := int64(limit * 512)
	if chunkSize > endOffset {
		chunkSize = endOffset
	}

	startOffset := endOffset - chunkSize
	if startOffset < 0 {
		startOffset = 0
	}

	if _, err := f.Seek(startOffset, io.SeekStart); err != nil {
		return []string{}, 0
	}

	reader := bufio.NewReader(io.LimitReader(f, chunkSize))

	if startOffset > 0 {
		_, _ = reader.ReadString('\n')
	}

	var allLines []string
	for {
		line, err := reader.ReadString('\n')
		line = strings.TrimRight(line, "\r\n")
		if line != "" {
			if keyword == "" || strings.Contains(strings.ToLower(line), strings.ToLower(keyword)) {
				allLines = append(allLines, line)
			}
		}
		if err != nil {
			break
		}
	}

	if len(allLines) > limit {
		allLines = allLines[len(allLines)-limit:]
	}

	var nextOffset int64
	if startOffset > 0 {
		nextOffset = startOffset
	}

	return allLines, nextOffset
}

func encodeCursor(offset int64) string {
	return base64.StdEncoding.EncodeToString([]byte(strconv.FormatInt(offset, 10)))
}

func formatFileSize(b int64) string {
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
