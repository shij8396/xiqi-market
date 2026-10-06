FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
RUN mkdir uploads && chown node:node uploads
USER node
ENV LISTEN_HOST=0.0.0.0
EXPOSE 3088
CMD ["node", "server/index.js"]
