# The Last Mile — backend image. PROTOTYPE — Simulated DPI & Synthetic Data Only.
# Build from the REPOSITORY ROOT so the pre-cached Urdu audio prompts can be copied in:
#   docker build -f backend/Dockerfile -t lastmile-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VOICE_ASSETS_DIR=/app/frontend/public/audio

# System libraries for OpenCV (libgl/libglib), Pillow (jpeg/zlib), pyzbar (libzbar) and onnxruntime (libgomp)
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libzbar0 libgomp1 libjpeg62-turbo zlib1g \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/ /app/backend/
COPY frontend/public/audio/ /app/frontend/public/audio/

# RapidOCR 3 fetches its ONNX models on first use: bake them into the image so the first upload is instant
# and the container never needs outbound network for OCR.
RUN python -c "from rapidocr import RapidOCR; RapidOCR()"

RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/health')"

# Migrate, seed (idempotent: safe on every restart), then serve.
CMD ["sh", "-c", "alembic upgrade head && python scripts/seed_demo.py --families 40 && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
