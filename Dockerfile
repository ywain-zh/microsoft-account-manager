FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts ./scripts
COPY src ./src
COPY worker ./worker
COPY package*.json ./
COPY wrangler.toml ./
COPY tsconfig*.json ./
COPY vite.config.ts ./

EXPOSE 8787

# 1) Ensure local D1 schema is up-to-date
# 2) Run Worker locally with static assets binding from ./dist
CMD ["sh", "-c", "npm run migrate:local && npx wrangler dev --local --ip 0.0.0.0 --port ${PORT}"]
