# Playwright ships an official image with Chromium + all deps preinstalled.
# Pinning to a known-good version keeps the stealth fingerprint stable.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start"]