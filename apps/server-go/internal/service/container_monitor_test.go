package service

import "testing"

// Guards the "外部依赖容器也纳入容器监控" 逻辑:仅按 aetherblog-* 前缀过滤时,
// 用户把 REDIS_HOST 指向自管的 redis-server / 外部 IP 就会在监控里看不到,
// 误以为 Redis 挂了。matchesLinkedTarget 要对容器名和宿主端口两种匹配方式都
// 命中,同时不能把无关 Redis 容器误纳入。
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
			name: "public port matches but image hint misses → no match",
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
			name: "image matches but port misses → no match",
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
			name: "empty host → fall through to port+image path",
			c: dockerContainer{
				Image: "postgres:17",
				Ports: []dockerPort{
					{PrivatePort: 5432, PublicPort: 5432, Type: "tcp"},
				},
			},
			cname: "my_postgres",
			targets: []LinkedTarget{
				{Host: "", Port: 5432, ImageHint: "postgres"},
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
