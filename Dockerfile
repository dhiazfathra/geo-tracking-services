# Build stage
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
# Use --omit=dev to save space and use npm prune later
RUN npm install --production=false && npm cache clean --force

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Prune dependencies to save space
RUN npm prune --production

# Production stage
FROM node:22-alpine AS production

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Install only Prisma CLI
RUN npm install prisma --no-save && npx prisma generate && npm cache clean --force

# Expose application port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Create startup script to run migrations before starting the app
COPY scripts/start-with-migrations.sh ./
RUN chmod +x start-with-migrations.sh

# Start the application with migrations
CMD ["./start-with-migrations.sh"]
