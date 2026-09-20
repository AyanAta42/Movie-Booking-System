# One image, two microservices. The SERVICE env var decides whether a container
# serves browsing or booking — see src/app.ts. Building once and running it in
# two roles is also how it deploys: one image in ECR, two ECS services.

# ---- build: compile TypeScript and generate the Prisma client ----------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Prisma's query engine links against OpenSSL, which the slim image leaves out.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Dependencies before source, so editing code does not re-run npm ci.
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---- migrate: one-shot job that applies migrations, then exits ---------------
# Needs the prisma CLI, a devDependency, so it reuses the build stage rather
# than shipping the CLI in the runtime image. On AWS this is a one-off ECS task
# run before the services roll out.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime: production dependencies and compiled JS only ------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# --omit=optional: @prisma/client lists the prisma CLI and TypeScript as
# optional peers, so the lockfile marks them "devOptional" — and npm keeps a
# devOptional package unless BOTH dev and optional are omitted. Without this,
# ~110 MB of build tooling the running server never loads ships in the image.
# (No production package is optional, so nothing else is dropped.) The cache is
# cleared in the same layer, or it stays in the image anyway.
# --ignore-scripts: the generated client is copied from the build stage below,
# so @prisma/client's postinstall must not try to regenerate it without the CLI.
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
