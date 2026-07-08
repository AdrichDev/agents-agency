# Render/Railway deploy — AA (agents-agency) back.
# Monorepo: copy the whole repo and run the server from back/ so any relative
# imports to sibling dirs (shared/, front/) resolve at runtime.
FROM node:22-slim

# openssl is required by Prisma engines on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

WORKDIR /app/back
# prisma.config.ts (Prisma 7) eagerly resolves DATABASE_URL when the Prisma CLI
# loads (postinstall runs `prisma generate` too). `generate` never connects, so a
# build-only placeholder is enough; Render injects the real DATABASE_URL at runtime.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    npm ci && \
    DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    npx prisma generate

# Render/Railway inject PORT; the server reads process.env.PORT.
CMD ["npm", "start"]
