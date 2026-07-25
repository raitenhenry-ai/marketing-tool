FROM node:22-slim

# ffmpeg for clip splitting/overlays, DejaVu fonts for the burned-in text
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

# Note: no VOLUME instruction here - Railway rejects it. Attach persistent
# storage through your host instead (Railway/Render: add a volume mounted at
# /app/data in the dashboard; plain Docker: -v shortform-data:/app/data).

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
