FROM node:24-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS api-build
COPY apps/api apps/api
RUN npm run build --workspace @freekiosk-manager/api && npm prune --omit=dev && mkdir -p apps/api/node_modules

FROM node:24-alpine AS api
ENV NODE_ENV=production
WORKDIR /workspace/apps/api
COPY --from=api-build --chown=node:node /workspace/node_modules /workspace/node_modules
COPY --from=api-build --chown=node:node /workspace/apps/api/node_modules ./node_modules
COPY --from=api-build --chown=node:node /workspace/apps/api/package.json ./package.json
COPY --from=api-build --chown=node:node /workspace/apps/api/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

# Keeps the Prisma CLI, which the running server does not need: this one runs once and exits
FROM dependencies AS migrate
RUN apk add --no-cache openssl
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
WORKDIR /workspace/apps/api
# Fetches the migration engine now, so starting the stack needs no download
RUN npx prisma version
CMD ["npx", "prisma", "migrate", "deploy"]

FROM dependencies AS web-build
COPY apps/web apps/web
RUN npm run build --workspace @freekiosk-manager/web

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
