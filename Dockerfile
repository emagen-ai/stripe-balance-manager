FROM node:20-alpine

# Install OpenSSL and other dependencies for Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --production=false

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm ci --production=true && npm cache clean --force

# Create logs directory and make scripts executable
RUN mkdir -p logs && chmod +x scripts/start.sh

EXPOSE 3000

CMD ["npm", "start"]