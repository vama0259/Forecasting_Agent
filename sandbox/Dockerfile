# sandbox/Dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    time \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 agent

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

RUN mkdir -p /workspace /entrypoints /large_tool_results && chown -R agent:agent /workspace /entrypoints /large_tool_results
COPY entrypoints/validate.py /entrypoints/validate.py

USER agent
WORKDIR /workspace
