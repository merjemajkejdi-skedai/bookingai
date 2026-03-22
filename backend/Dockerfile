FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production=false

# Copy source code
COPY . .

# Create data directory (used by SQLite in local dev — ignored in production)
RUN mkdir -p data

EXPOSE 3001

# Start with tsx/esm (same as local dev, no build step needed)
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
