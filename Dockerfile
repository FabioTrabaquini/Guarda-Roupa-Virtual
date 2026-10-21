FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
ENV NODE_ENV=production
ENV APP_DATA_DIR=/var/lib/guarda-roupa
RUN mkdir -p "$APP_DATA_DIR" && chown -R node:node "$APP_DATA_DIR"
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
