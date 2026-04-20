package service

import "testing"

// Guards the "外部依赖容器也纳入容器监控" 逻辑:仅按 aetherblog-* 前缀过滤时,
// 用户把 REDIS_HOST 指向自管的 redis-server / 外部 IP 就会在监控里看不到,
// 误以为 Redis 挂了。matchesLinkedTarget 对 Host 必须分两档:
//   - Host 是容器名 → 只认容器名精确匹配
//   - Host 是 IP 字面量 → 才退到 PublicPort + ImageHint 指纹匹配
//
// 绝对不能两档同时启用,否则宿主机上另一个同端口 + 同镜像的无关容器
// (比如 my_postgres 相对于 aetherblog-postgres)会被误纳入监控。
func TestMatchesLinkedTarget(t *testing.T) {
	cases := []struct {
		name    string
		c       dockerContainer
		cname   string
		targets []LinkedTarget
		want    bool
	}{
		{
			name:    "no targets → never match",
			c:       dockerContainer{Image: "redis:latest"},
			cname:   "redis-server",
			targets: nil,
			want:    false,
		},
		{
			name:  "hostname exact match (compose service name)",
			c:     dockerContainer{Image: "redis:latest"},
			cname: "redis-server",
			targets: []LinkedTarget{
				{Host: "redis-server", Port: 6379, ImageHint: "redis"},
			},
			want: true,
		},
		{
			name:  "hostname case-insensitive",
			c:     dockerContainer{Image: "redis:7-alpine"},
			cname: "Redis-Server",
			targets: []LinkedTarget{
				{Host: "redis-server", Port: 6379, ImageHint: "redis"},
			},
			want: true,
		},
		{
			name: "host is IP → fallback match by public port + image hint",
			c: dockerContainer{
				Image: "redis:latest",
				Ports: []dockerPort{
					{PrivatePort: 6379, PublicPort: 6999, Type: "tcp"},
				},
			},
			cname: "redis-server",
			targets: []LinkedTarget{
				{Host: "124.22.30.10", Port: 6999, ImageHint: "redis"},
			},
			want: true,
		},
		{
			name: "IP host: public port matches but image hint misses → no match",
			c: dockerContainer{
				Image: "myapp:latest",
				Ports: []dockerPort{
					{PrivatePort: 6379, PublicPort: 6999, Type: "tcp"},
				},
			},
			cname: "random-app",
			targets: []LinkedTarget{
				{Host: "124.22.30.10", Port: 6999, ImageHint: "redis"},
			},
			want: false,
		},
		{
			name: "IP host: image matches but port misses → no match",
			c: dockerContainer{
				Image: "redis:latest",
				Ports: []dockerPort{
					{PrivatePort: 6379, PublicPort: 1234, Type: "tcp"},
				},
			},
			cname: "other-redis",
			targets: []LinkedTarget{
				{Host: "124.22.30.10", Port: 6999, ImageHint: "redis"},
			},
			want: false,
		},
		{
			// 核心回归: Host 是容器名(非 IP),绝对不能走 port+image fallback,
			// 否则 my_postgres 会被误认为是 aetherblog-postgres。
			name: "hostname (non-IP) must NOT fall through to port+image — my_postgres scenario",
			c: dockerContainer{
				Image: "postgres:17",
				Ports: []dockerPort{
					{PrivatePort: 5432, PublicPort: 5432, Type: "tcp"},
				},
			},
			cname: "my_postgres",
			targets: []LinkedTarget{
				{Host: "aetherblog-postgres", Port: 5432, ImageHint: "postgres"},
			},
			want: false,
		},
		{
			name: "IPv6 literal host is accepted as IP → port+image fallback enabled",
			c: dockerContainer{
				Image: "redis:7",
				Ports: []dockerPort{
					{PrivatePort: 6379, PublicPort: 6999, Type: "tcp"},
				},
			},
			cname: "some-redis",
			targets: []LinkedTarget{
				{Host: "::1", Port: 6999, ImageHint: "redis"},
			},
			want: true,
		},
		{
			name: "multiple targets → any match wins",
			c: dockerContainer{
				Image: "redis:latest",
				Ports: []dockerPort{
					{PrivatePort: 6379, PublicPort: 6999, Type: "tcp"},
				},
			},
			cname: "some-name",
			targets: []LinkedTarget{
				{Host: "aetherblog-postgres", Port: 5432, ImageHint: "postgres"},
				{Host: "124.22.30.10", Port: 6999, ImageHint: "redis"},
			},
			want: true,
		},
		{
			name: "empty host entry is ignored, other target still evaluated",
			c: dockerContainer{
				Image: "redis:7",
				Ports: []dockerPort{
					{PrivatePort: 6379, PublicPort: 6999, Type: "tcp"},
				},
			},
			cname: "redis-server",
			targets: []LinkedTarget{
				{Host: "", Port: 5432, ImageHint: "postgres"},
				{Host: "redis-server", Port: 6379, ImageHint: "redis"},
			},
			want: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := matchesLinkedTarget(tc.c, tc.cname, tc.targets)
			if got != tc.want {
				t.Fatalf("matchesLinkedTarget(%q) = %v, want %v", tc.cname, got, tc.want)
			}
		})
	}
}
