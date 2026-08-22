FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV CUDA_VISIBLE_DEVICES=-1

# Keep native math libraries conservative on the 2-vCPU service. Paddle gets
# its own configured CPU thread count at runtime.
ENV OMP_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgomp1 \
    libglib2.0-0 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt

COPY . .

# Paddle is expected on most successful OCR jobs. Force model acquisition at
# image-build time so the first user does not pay the model download penalty.
RUN OCR_PADDLE_WARM_MODE=off python paddle_prefetch.py

CMD ["sh","-c","exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 2 --timeout 900 --graceful-timeout 30 --access-logfile - --error-logfile - server:app"]
