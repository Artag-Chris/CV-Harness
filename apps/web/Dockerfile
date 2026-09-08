# syntax=docker/dockerfile:1
# Dashboard web (Next.js). El cliente llama a /api/* y Next hace rewrite hacia
# el contenedor del api (API_PROXY_TARGET).
FROM node:20-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./

FROM base AS deps
RUN npm ci

FROM deps AS builder
COPY . .
ARG API_PROXY_TARGET=http://cvharness-api:3100/api
ENV API_PROXY_TARGET=$API_PROXY_TARGET
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG API_PROXY_TARGET=http://cvharness-api:3100/api
ENV API_PROXY_TARGET=$API_PROXY_TARGET
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
EXPOSE 3001
CMD ["npm", "run", "start"]
