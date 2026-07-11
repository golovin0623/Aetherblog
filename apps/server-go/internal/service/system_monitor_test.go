package service

import (
	"sync"
	"testing"
	"time"
)

func TestCollectSystemMetricPartsRunsConcurrentlyAndPreservesValues(t *testing.T) {
	started := make(chan string, 4)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer func() { releaseOnce.Do(func() { close(release) }) }()

	waitForRelease := func(name string) {
		started <- name
		<-release
	}

	resultCh := make(chan systemMetricParts, 1)
	go func() {
		resultCh <- collectSystemMetricParts(
			func() float64 {
				waitForRelease("cpu")
				return 42.5
			},
			func(memory *MemoryMetrics) {
				waitForRelease("memory")
				memory.TotalBytes = 1024
				memory.UsedBytes = 768
			},
			func() DiskMetrics {
				waitForRelease("disk")
				return DiskMetrics{TotalBytes: 2048, UsedBytes: 512, Path: "/data"}
			},
			func() NetworkMetrics {
				waitForRelease("network")
				return NetworkMetrics{BytesIn: 11, BytesOut: 22}
			},
		)
	}()

	seen := make(map[string]bool, 4)
	for range 4 {
		select {
		case name := <-started:
			seen[name] = true
		case <-time.After(500 * time.Millisecond):
			t.Fatalf("collectors did not all start concurrently; started=%v", seen)
		}
	}
	releaseOnce.Do(func() { close(release) })

	var got systemMetricParts
	select {
	case got = <-resultCh:
	case <-time.After(time.Second):
		t.Fatal("concurrent metric collection did not finish")
	}

	if len(seen) != 4 {
		t.Fatalf("started collectors = %v, want cpu/memory/disk/network", seen)
	}
	if got.CPUUsage != 42.5 {
		t.Fatalf("CPUUsage = %v, want 42.5", got.CPUUsage)
	}
	if got.OSMemory.TotalBytes != 1024 || got.OSMemory.UsedBytes != 768 {
		t.Fatalf("OSMemory = %#v, want total=1024 used=768", got.OSMemory)
	}
	if got.Disk.Path != "/data" || got.Disk.TotalBytes != 2048 || got.Disk.UsedBytes != 512 {
		t.Fatalf("Disk = %#v, want /data totals", got.Disk)
	}
	if got.Network.BytesIn != 11 || got.Network.BytesOut != 22 {
		t.Fatalf("Network = %#v, want bytesIn=11 bytesOut=22", got.Network)
	}
}
