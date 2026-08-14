# sandbox/Dockerfile
FROM python:3.12-slim

RUN useradd --create-home --uid 1000 agent

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

RUN mkdir -p /workspace /entrypoints && chown -R agent:agent /workspace /entrypoints
COPY entrypoints/validate.py /entrypoints/validate.py

USER agent
WORKDIR /workspace
