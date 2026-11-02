# Motion Studio server with Chromium and ffmpeg, for any Docker host
# (Hugging Face Spaces, Render, Railway, Fly.io, a VPS…).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium ffmpeg ca-certificates \
    fonts-noto-core fonts-noto-color-emoji fonts-liberation fontconfig \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    CHROME_PATH=/usr/bin/chromium \
    FFMPEG_BIN=/usr/bin/ffmpeg

# Hugging Face runs containers as uid 1000, which is the image's "node" user.
USER node
WORKDIR /home/node/app

COPY --chown=node:node package.json package-lock.json ./
# Scripts are skipped because ffmpeg comes from the system package.
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY --chown=node:node . .
RUN npm run build && mkdir -p renders .data

EXPOSE 7860
CMD ["node", "server/index.js"]
