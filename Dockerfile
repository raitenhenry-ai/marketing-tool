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

# Persist the queue + rendered clips across restarts
VOLUME /app/data

CMD ["node", "src/server.js"]
