# Imagen de producción para Easypanel.
# Se basa en la imagen oficial de Playwright, que ya trae Chromium para generar los PDF.
# La versión debe coincidir con la de "playwright" en server/package.json.

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DIR=/data
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/package.json ./
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=pwuser:pwuser /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=pwuser:pwuser /app/server/package.json ./server/
COPY --from=build --chown=pwuser:pwuser /app/server/dist ./server/dist
COPY --from=build --chown=pwuser:pwuser /app/server/templates ./server/templates
COPY --from=build --chown=pwuser:pwuser /app/server/assets ./server/assets
COPY --from=build --chown=pwuser:pwuser /app/web/dist ./web/dist
RUN mkdir -p /data && chown pwuser:pwuser /data
USER pwuser
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
