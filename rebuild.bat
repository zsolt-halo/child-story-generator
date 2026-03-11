@echo off
set OTEL_EXPORTER=otlp
docker compose --profile observability up --build -d
