FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY apps/ai-service/requirements.txt ./
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/ai-service/app ./app

# 创建非 root 用户（与后端相同的 UID/GID，以便可以访问共享卷）。
# /app/logs 扩展至模式 0775，因此从此映像初始化命名卷
# 即使正在运行的容器的主要组与其他组不同，仍保持组可写
# 图像的应用程序组（例如，当 compose 注入 group_add 以进行 Docker.sock 访问时）。
RUN mkdir -p /app/logs && \
    addgroup --gid 1001 appgroup && \
    adduser --uid 1001 --gid 1001 --disabled-password --gecos "" appuser && \
    chown -R appuser:appgroup /app && \
    chmod 0775 /app/logs

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
