FROM python:3.12-slim

# demoparser2 is a Rust-compiled wheel — no build-essential needed
# psycopg2-binary is a prebuilt wheel — no libpq-dev needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer caching)
COPY services/scout/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the shared db/ and api/ modules needed by the service
COPY db/ ./db/
COPY api/ ./api/

# Copy the Scout service itself
COPY services/scout/parse_demo.py .
COPY services/scout/service.py .

ENV PORT=8001
EXPOSE 8001

CMD ["sh", "-c", "uvicorn service:app --host 0.0.0.0 --port ${PORT}"]
