FROM node:22.22.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM node:22.22.0-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ca-certificates tini wget

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DB_PATH=/app/data/account-manager.db
ENV AUTO_IMPORT_LEGACY_DB=true

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json

EXPOSE 8787
VOLUME ["/app/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/server/main.js"]
