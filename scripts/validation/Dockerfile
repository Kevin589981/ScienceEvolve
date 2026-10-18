# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS node_runtime
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node_runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY python-requirements.lock.txt /opt/validation/python-requirements.lock.txt
RUN python -m pip install --no-cache-dir -r /opt/validation/python-requirements.lock.txt && python -m pip check
COPY run-python-tests.py /opt/validation/run-python-tests.py
# The SDK's POSIX helper default uses the conventional system path.
RUN ln -s /usr/local/bin/python3 /usr/bin/python3
RUN useradd --uid 10001 --create-home validation
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLCONFIGDIR=/tmp/matplotlib OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 LANGCHAIN_TRACING_V2=false
USER 10001
WORKDIR /work
CMD ["python", "-B", "/opt/validation/run-python-tests.py", "--root", "/work"]
