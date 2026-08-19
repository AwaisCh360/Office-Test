FROM python:3.12-slim

WORKDIR /app

# Install docker CLI so celery worker can spawn sandbox containers
RUN apt-get update && apt-get install -y docker.io curl && rm -rf /var/lib/apt/lists/*

# Install python dependencies
# Copy project files
COPY . /app/
RUN pip install --no-cache-dir -e ./strix
RUN pip install --no-cache-dir celery redis

# Start command depends on how the container is run (FastAPI or Celery)
# Change WORKDIR so Python finds the strix module natively when running celery
WORKDIR /app/strix
CMD ["celery", "-A", "strix.interface.viewer.tasks", "worker", "--loglevel=info", "--concurrency=10"]
