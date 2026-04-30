FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

RUN npm run db:generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 appuser \
  && useradd --uid 1001 --gid appuser --shell /bin/bash --create-home appuser

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/.next ./.next
COPY --from=base /app/public* ./public/

USER appuser

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
