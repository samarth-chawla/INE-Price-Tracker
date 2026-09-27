# INE Tracker backend — production image for Render (Docker runtime).
# Installs the Playwright-bundled Chromium + OS deps so the Phase 2 scraper
# runs on Linux (no system Chrome assumed). Secrets come from Render
# environment variables at runtime — never baked into the image.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Browser + system libraries for headless Chromium (matches installed Playwright).
RUN npx playwright install --with-deps chromium

COPY . ./

# Render injects PORT at runtime; the server already honors process.env.PORT.
EXPOSE 3001

CMD ["node", "server.js"]
