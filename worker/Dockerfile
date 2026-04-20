# Remotion needs Chromium + ffmpeg → use the official Node image and install both.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV REMOTION_CHROMIUM_EXECUTABLE=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8787
CMD ["npm", "run", "start"]