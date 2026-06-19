FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22.22.0-bookworm-slim AS runtime-deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.runtime.json ./package.json
COPY package.runtime-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22.22.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DB_PATH=/app/data/account-manager.db
ENV AUTO_IMPORT_LEGACY_DB=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl docker.io python3 tini wget \
  && rm -rf /var/lib/apt/lists/*

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/package.json ./package.json
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

EXPOSE 8787
VOLUME ["/app/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build/server/main.js"]
