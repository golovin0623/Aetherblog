import os

# Set environment variables for testing before app modules are imported
os.environ["JWT_SECRET"] = "test-secret"
os.environ["POSTGRES_DSN"] = "postgresql://test:test@localhost:5432/test_db"

# noqa: E402
