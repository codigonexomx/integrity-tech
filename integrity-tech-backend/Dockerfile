# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json nest-cli.json tsconfig*.json ./
COPY prisma ./prisma
COPY src ./src
COPY test ./test
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN apk add --no-cache curl openssl \
  && addgroup -S nodeapp \
  && adduser -S nodeapp -G nodeapp
COPY --from=build --chown=nodeapp:nodeapp /app/node_modules ./node_modules
COPY --from=build --chown=nodeapp:nodeapp /app/dist ./dist
COPY --from=build --chown=nodeapp:nodeapp /app/prisma ./prisma
COPY --from=build --chown=nodeapp:nodeapp /app/package.json ./package.json
RUN mkdir -p /app/.private-storage && chown nodeapp:nodeapp /app/.private-storage
USER nodeapp
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health/live || exit 1
CMD ["node", "dist/main.js"]
