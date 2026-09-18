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

# Camoufox（反检测 Firefox）依赖层：pip 包 + 浏览器引擎（约 1GB）+ GeoIP 数据。
# 单独分层，源码变更时不重复下载。引擎安装路径为 XDG_CACHE_HOME=/opt/camoufox-cache
# （Linux 默认 ~/.cache/camoufox，运行层通过同一环境变量指向复制的目录）。
FROM node:22.22.0-bookworm-slim AS camoufox
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
     libgtk-3-0 libasound2 libdbus-glib-1-2 libx11-xcb1 libxcomposite1 \
     libxdamage1 libxrandr2 libatk1.0-0 libatk-bridge2.0-0 libpango-1.0-0 \
     libcairo2 libgdk-pixbuf-2.0-0 libxss1 libxtst6 \
  && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages 'camoufox[geoip]>=0.5.4' 'playwright>=1.50,<2'
ENV XDG_CACHE_HOME=/opt/camoufox-cache
RUN python3 -m camoufox fetch

FROM node:22.22.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DB_PATH=/app/data/account-manager.db
ENV AUTO_IMPORT_LEGACY_DB=true
ENV DIAN115_PYTHON=python3
ENV XDG_CACHE_HOME=/opt/camoufox-cache

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl docker.io python3 tini wget \
     libgtk-3-0 libasound2 libdbus-glib-1-2 libx11-xcb1 libxcomposite1 \
     libxdamage1 libxrandr2 libatk1.0-0 libatk-bridge2.0-0 libpango-1.0-0 \
     libcairo2 libgdk-pixbuf-2.0-0 libxss1 libxtst6 \
  && rm -rf /var/lib/apt/lists/*

# Camoufox Python 依赖与浏览器引擎（含 GeoIP，与 camoufox 层同用 XDG_CACHE_HOME）
COPY --from=camoufox /usr/local/lib/python3.11/dist-packages /usr/local/lib/python3.11/dist-packages
COPY --from=camoufox /opt/camoufox-cache /opt/camoufox-cache

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/package.json ./package.json
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

EXPOSE 8787
VOLUME ["/app/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build/server/main.js"]
