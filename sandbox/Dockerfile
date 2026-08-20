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

# Correct-by-construction helpers for agent-written scripts. Baked into the image (not bind-mounted)
# so they exist in the explore tier, where the agent writes its model -- the validate tier's
# read-only forecasting_agent mount comes too late to prevent a leaky training loop being authored.
COPY agent_lib /opt/agent_lib
ENV PYTHONPATH=/opt/agent_lib

USER agent
WORKDIR /workspace
