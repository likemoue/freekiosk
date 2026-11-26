# Base images are pinned to a version and digest; Dependabot (docker, /cloud/deploy) proposes the next ones
FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS api-build
COPY apps/api apps/api
RUN npm run build --workspace @freekiosk-manager/api && npm prune --omit=dev && mkdir -p apps/api/node_modules

FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS api
ENV NODE_ENV=production
# OS fixes that came out after the base image. The server runs `node` alone, so the npm, corepack and yarn
# the image ships are dropped: npm bundles its own undici and brace-expansion, which Trivy flags
RUN apk upgrade --no-cache  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v*       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
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

# The official image, run unprivileged the way nginxinc/nginx-unprivileged does it: that image has had no
# build since 1.30.6 (19/10/2026), whose nginx has 4 CRITICAL CVEs fixed in 1.30.7
FROM nginx:1.30.8-alpine@sha256:8eb04fe3b385090e9aa02961f77398ad09b6bf33ab07f6669a5bb7acce22c0d3 AS web
# (no user directive, the pid file in /tmp, the temp paths of /var/cache/nginx writable by nginx, uid 101)
RUN apk upgrade --no-cache \
 && sed -i -e '/^user /d' -e 's,^pid .*,pid /tmp/nginx.pid;,' /etc/nginx/nginx.conf \
 && chown -R 101:0 /var/cache/nginx \
 && chmod -R g+w /var/cache/nginx
USER 101
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
