# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG BACKEND_URL=http://backend:3001
ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_APP_VERSION=1.0.0
ARG NEXT_PUBLIC_BACKEND_VERSION=1.0.0
ARG NEXT_PUBLIC_BUILD_DATE=container
ENV BACKEND_URL=${BACKEND_URL}
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_BACKEND_VERSION=${NEXT_PUBLIC_BACKEND_VERSION}
ENV NEXT_PUBLIC_BUILD_DATE=${NEXT_PUBLIC_BUILD_DATE}
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.js tsconfig.json tailwind.config.js postcss.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN apk add --no-cache curl \
  && addgroup -S nextapp \
  && adduser -S nextapp -G nextapp
COPY --from=build --chown=nextapp:nextapp /app/.next ./.next
COPY --from=build --chown=nextapp:nextapp /app/public ./public
COPY --from=build --chown=nextapp:nextapp /app/node_modules ./node_modules
COPY --from=build --chown=nextapp:nextapp /app/package.json ./package.json
COPY --from=build --chown=nextapp:nextapp /app/next.config.js ./next.config.js
USER nextapp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/ || exit 1
CMD ["npm", "run", "start"]
