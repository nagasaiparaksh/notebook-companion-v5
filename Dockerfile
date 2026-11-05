# Notebook Companion: one container that builds the React app and serves it with the Flask backend.
# Data (notebooks, course material, backups) lives in /data: mount a persistent disk there.

# ---- 1. build the frontend
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. run the backend
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    DATABASE_PATH=/data/notes.db BACKUP_DIR=/data/backups TRUST_PROXY=1 PORT=8000
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt gunicorn
COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist
RUN mkdir -p /data
EXPOSE 8000
# one process (SQLite + the Gnani one-request-at-a-time lock live in memory), many threads; threads also carry the
# live-caption WebSockets. Long timeout: lecture notes and study material can take a minute.
CMD gunicorn --workers 1 --worker-class gthread --threads 32 --timeout 300 --bind 0.0.0.0:${PORT} "app:create_app()"
