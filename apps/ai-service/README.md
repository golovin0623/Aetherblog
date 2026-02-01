# AetherBlog AI Service

Independent AI service (FastAPI + LiteLLM) for content generation, RAG, and streaming output.

## Local run
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Default URL: http://localhost:8000

- Health: `/health`
- AI APIs: `/api/v1/ai/*`
- Search: `/api/v1/search/semantic`
