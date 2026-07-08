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
RUN npm ci && npx prisma generate

# Render/Railway inject PORT; the server reads process.env.PORT.
CMD ["npm", "start"]
