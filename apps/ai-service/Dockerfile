FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY apps/ai-service/requirements.txt ./
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/ai-service/app ./app

# Create non-root user (same UID/GID as backend so shared volumes are accessible).
# /app/logs is widened to mode 0775 so a named volume initialized from this image
# stays group-writable even if the running container's primary group differs from
# the image's appgroup (e.g. when compose injects group_add for docker.sock access).
RUN mkdir -p /app/logs && \
    addgroup --gid 1001 appgroup && \
    adduser --uid 1001 --gid 1001 --disabled-password --gecos "" appuser && \
    chown -R appuser:appgroup /app && \
    chmod 0775 /app/logs

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
