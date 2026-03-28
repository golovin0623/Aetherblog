.PHONY: build run test clean docker docker-run

BINARY=server
MAIN=./cmd/server

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
