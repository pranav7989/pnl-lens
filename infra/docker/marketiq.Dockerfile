# @file  infra/docker/marketiq.Dockerfile
# @area  Ops
# @what  Market IQ data service image (Python 3.11 + FastAPI): non-root, read-only friendly, SQLite in /data. Build context = repo root.
FROM python:3.11.17-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Kolkata MARKET_IQ_DB=/data/market_iq.db
WORKDIR /srv
COPY services/market-iq/requirements.txt .
# runtime packages only (the dev tools at the end of requirements.txt are not installed)
RUN sed -n '/^# dev/q;p' requirements.txt > runtime.txt && pip install --retries 5 -r runtime.txt && rm runtime.txt
COPY services/market-iq/app app
RUN useradd --uid 1000 --create-home market && mkdir -p /data && chown market:market /data
USER market
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
