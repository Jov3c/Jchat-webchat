# ---------- 构建阶段 ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client
COPY . .
RUN npm run build --prefix client

# ---------- 运行阶段 ----------
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/index.js ./index.js
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
# 数据库 server/data 与上传 public/uploads 通过 volume 持久化，见 deploy/docker/docker-compose.yml
CMD ["node", "index.js"]
