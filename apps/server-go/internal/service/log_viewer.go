package service

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
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
	Name     string    `json:"name"`
	Level    string    `json:"level"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

// LogViewerService reads application log files.
type LogViewerService struct {
	cfg *config.Config
}

func NewLogViewerService(cfg *config.Config) *LogViewerService {
	return &LogViewerService{cfg: cfg}
}

// logFileMap maps level names to log file names.
var logFileMap = map[string]string{
	"ALL":   "aetherblog.log",
	"INFO":  "info.log",
	"WARN":  "warn.log",
	"ERROR": "error.log",
	"DEBUG": "debug.log",
}

// ListLogFiles returns information about available log files.
func (s *LogViewerService) ListLogFiles() []LogFileInfo {
	var files []LogFileInfo
	logDir := s.cfg.Log.Path

	for level, name := range logFileMap {
		path := filepath.Join(logDir, name)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		files = append(files, LogFileInfo{
			Name:     name,
			Level:    level,
			Size:     info.Size(),
			Modified: info.ModTime(),
		})
	}

	return files
}

// ReadLogs reads log lines from the end of the specified log file.
func (s *LogViewerService) ReadLogs(level string, limit int, keyword string, cursor string) (*LogReadResult, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}

	level = strings.ToUpper(level)
	if level == "" {
		level = "ALL"
	}

	fileName, ok := logFileMap[level]
	if !ok {
		return nil, fmt.Errorf("unknown log level: %s", level)
	}

	logPath := filepath.Join(s.cfg.Log.Path, fileName)

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

	// Determine read offset from cursor
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

	// Read from the end of the file
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

// readTailLines reads the last N lines from a file ending at the given offset.
func readTailLines(f *os.File, endOffset int64, limit int, keyword string) ([]string, int64) {
	if endOffset <= 0 {
		return []string{}, 0
	}

	// Read a chunk from the end
	chunkSize := int64(limit * 512) // estimate ~512 bytes per line
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

	// If we didn't start from the beginning, skip the first partial line
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

	// Take the last `limit` lines
	if len(allLines) > limit {
		allLines = allLines[len(allLines)-limit:]
	}

	// Calculate next cursor (for reading older entries)
	var nextOffset int64
	if startOffset > 0 {
		nextOffset = startOffset
	}

	return allLines, nextOffset
}

func encodeCursor(offset int64) string {
	return base64.StdEncoding.EncodeToString([]byte(strconv.FormatInt(offset, 10)))
}
