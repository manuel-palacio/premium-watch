# Build context: repository root.  docker build -f api/Dockerfile -t premium-watch-api .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY api/package.json api/
COPY job/package.json job/
COPY firestore/package.json firestore/
RUN npm ci -w @pw/shared -w @pw/web -w @pw/api --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY web web
COPY api api
RUN npm run build -w @pw/shared && npm run build -w @pw/web && npm run build -w @pw/api

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY api/package.json api/
COPY job/package.json job/
COPY firestore/package.json firestore/
RUN npm ci -w @pw/shared -w @pw/api --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/web/dist public
ENV STATIC_DIR=/app/public PORT=8080
USER node
EXPOSE 8080
CMD ["node", "api/dist/server.js"]
