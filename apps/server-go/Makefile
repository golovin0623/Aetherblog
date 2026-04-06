.PHONY: build run test clean docker docker-run tidy lint migrate-up migrate-down migrate-create

BINARY=server
MAIN=./cmd/server
MIGRATIONS_DIR=./migrations

# Default DSN for local development
DATABASE_DSN ?= postgres://aetherblog:aetherblog123@localhost:5432/aetherblog?sslmode=disable

build:
	CGO_ENABLED=0 go build -ldflags="-s -w" -o $(BINARY) $(MAIN)

run:
	go run $(MAIN)

test:
	go test ./... -v -count=1

clean:
	rm -f $(BINARY)

docker:
	docker build -t aetherblog-backend-go .

docker-run:
	docker run --rm -p 8080:8080 \
		-e AETHERBLOG_DATABASE_HOST=host.docker.internal \
		-e AETHERBLOG_REDIS_HOST=host.docker.internal \
		aetherblog-backend-go

tidy:
	go mod tidy

lint:
	golangci-lint run ./...

# Database migrations (using golang-migrate CLI or go run)
migrate-up:
	go run ./cmd/migrate -dir $(MIGRATIONS_DIR) -dsn "$(DATABASE_DSN)" up

migrate-down:
	go run ./cmd/migrate -dir $(MIGRATIONS_DIR) -dsn "$(DATABASE_DSN)" down 1

migrate-create:
	@test -n "$(name)" || (echo "Usage: make migrate-create name=xxx" && exit 1)
	migrate create -ext sql -dir $(MIGRATIONS_DIR) -seq $(name)
