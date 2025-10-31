FROM node:24.11.0-slim AS builder

WORKDIR /app

# Enable Corepack for Yarn
RUN corepack enable

# Install dependencies
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN yarn build

# Production stage
FROM node:24.11.0-slim

# MCP Register Label
LABEL io.modelcontextprotocol.server.name="io.github.meloncafe/chromadb-remote-mcp"


# Create non-root user
RUN groupadd -r mcpuser && useradd -r -g mcpuser mcpuser

WORKDIR /app

# Enable Corepack for Yarn
RUN corepack enable

# Copy package files and install production dependencies only
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production --ignore-scripts \
    && yarn cache clean

# Copy built files from builder
COPY --from=builder /app/build ./build

# Set ownership to non-root user
RUN chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "build/index.js"]
