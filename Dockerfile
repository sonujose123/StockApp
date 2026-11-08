# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 normally ships a prebuilt binary; these tools are the fallback.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/stockly.db

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
