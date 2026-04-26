FROM node:22.22.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22.22.0-alpine AS runtime-deps
WORKDIR /app
COPY package.runtime.json ./package.json
COPY package.runtime-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22.22.0-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ca-certificates tini wget python3 py3-requests py3-pysocks

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DB_PATH=/app/data/account-manager.db
ENV AUTO_IMPORT_LEGACY_DB=true

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/package.json ./package.json
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/pay.py ./pay.py

EXPOSE 8787
VOLUME ["/app/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/server/main.js"]
