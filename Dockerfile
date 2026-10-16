FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "numpy<2" tflite-runtime birdnetlib librosa resampy fastapi uvicorn python-multipart httpx
WORKDIR /app
COPY app.py .
CMD ["sh","-c","uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000}"]
