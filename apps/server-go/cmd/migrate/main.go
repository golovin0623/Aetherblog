package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func resolveDefaultMigrationDir() string {
	candidates := []string{
		"./migrations",
		"../migrations",
		"../../migrations",
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			if abs, err := filepath.Abs(candidate); err == nil {
				return abs
			}
			return candidate
		}
	}
	return "./migrations"
}

func main() {
	dir := flag.String("dir", resolveDefaultMigrationDir(), "path to migration files")
	dsn := flag.String("dsn", "", "database DSN (postgres://user:pass@host:port/db?sslmode=disable)")
	flag.Parse()

	if *dsn == "" {
		// 回退到环境变量
		*dsn = os.Getenv("DATABASE_DSN")
		if *dsn == "" {
			fmt.Fprintln(os.Stderr, "error: -dsn flag or DATABASE_DSN env required")
			os.Exit(1)
		}
	}

	args := flag.Args()
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: migrate [-dir DIR] [-dsn DSN] <up|down [N]|version|force VERSION>")
		os.Exit(1)
	}

	m, err := migrate.New("file://"+*dir, *dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error creating migrator: %v\n", err)
		os.Exit(1)
	}
	defer m.Close()

	cmd := args[0]
	switch cmd {
	case "up":
		if err := m.Up(); err != nil && err != migrate.ErrNoChange {
			fmt.Fprintf(os.Stderr, "migrate up: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("migrations applied successfully")

	case "down":
		n := 1
		if len(args) > 1 {
			n, _ = strconv.Atoi(args[1])
			if n <= 0 {
				n = 1
			}
		}
		if err := m.Steps(-n); err != nil && err != migrate.ErrNoChange {
			fmt.Fprintf(os.Stderr, "migrate down %d: %v\n", n, err)
			os.Exit(1)
		}
		fmt.Printf("rolled back %d migration(s)\n", n)

	case "version":
		v, dirty, err := m.Version()
		if err != nil {
			fmt.Fprintf(os.Stderr, "version: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("version: %d, dirty: %v\n", v, dirty)

	case "force":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "usage: migrate force VERSION")
			os.Exit(1)
		}
		v, _ := strconv.Atoi(args[1])
		if err := m.Force(v); err != nil {
			fmt.Fprintf(os.Stderr, "force: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("forced version to %d\n", v)

	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", cmd)
		os.Exit(1)
	}
}
