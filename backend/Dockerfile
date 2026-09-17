FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production=false

# Copy source code
COPY . .

# Create data directory — used by SQLite in local dev, and as a fallback JWT
# secret store. This app has no persistent volume configured on Railway, so
# nothing written here survives a redeploy/restart — set JWT_SECRET as a
# real env var in production instead of relying on this fallback.
RUN mkdir -p data

EXPOSE 3001

# Start with tsx/esm (same as local dev, no build step needed)
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
