# Paste this file into a Hugging Face Space (SDK: Docker).
# It builds the studio straight from GitHub, so the Space needs no other files.
# After you update the GitHub repo, use Settings → "Factory rebuild" in the Space.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium ffmpeg ca-certificates git \
    fonts-noto-core fonts-noto-color-emoji fonts-liberation fontconfig \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    CHROME_PATH=/usr/bin/chromium \
    FFMPEG_BIN=/usr/bin/ffmpeg

USER node
WORKDIR /home/node/app

ARG REPO=https://github.com/amiramir5/motion-studio.git
ARG BRANCH=main
RUN git clone --depth 1 --branch "$BRANCH" "$REPO" . \
  && npm ci --ignore-scripts --no-audit --no-fund \
  && npm run build \
  && mkdir -p renders .data

EXPOSE 7860
CMD ["node", "server/index.js"]
