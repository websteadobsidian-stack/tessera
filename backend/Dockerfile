# Контекст сборки — корень репозитория (нужны пакет tessera и schema/).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY pyproject.toml README.md ./
COPY tessera ./tessera
RUN pip install --no-deps .

COPY schema ./schema
COPY backend ./backend

RUN useradd --system --no-create-home tessera
USER tessera
WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
