# StarlightScribe Frontend
# Multi-stage build: Node build → nginx serve

FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
ARG COMMIT_HASH=unknown
ENV VITE_COMMIT_HASH=$COMMIT_HASH

COPY . .
RUN npm run build


FROM nginx:alpine

# SPA routing + API reverse proxy config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Built static files
COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/ || exit 1
