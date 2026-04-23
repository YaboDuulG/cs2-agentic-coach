FROM python:3.12-slim

# awpy + demoparser2 system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY parse_demo.py .

CMD ["python", "parse_demo.py"]
