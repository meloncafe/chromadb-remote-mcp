[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/meloncafe-chromadb-remote-mcp-badge.png)](https://mseep.ai/app/meloncafe-chromadb-remote-mcp)

# ChromaDB Remote MCP Server

[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![codecov](https://codecov.io/gh/meloncafe/chromadb-remote-mcp/graph/badge.svg?token=0abUQsve4y)](https://codecov.io/gh/meloncafe/chromadb-remote-mcp)
[![DeepSource](https://app.deepsource.com/gh/meloncafe/chromadb-remote-mcp.svg/?label=Active+Issues&show_trend=true&token=Mzfb6tMnlzBIxaJO9CsYO3e8)](https://app.deepsource.com/gh/meloncafe/chromadb-remote-mcp/)

A **Streamable HTTP** MCP (Model Context Protocol) server that provides remote access to ChromaDB for AI assistants like Claude. Enables semantic search and vector database operations from mobile devices and remote locations.

> **Note**: This project uses MCP Streamable HTTP (2025-03-26 spec). SSE transport is deprecated.

[한국어 문서](README.ko.md)

---

## Cross-Platform AI Memory Server

**Compatible with ALL major AI platforms:**

- Claude (Desktop, Mobile, Code)
- Gemini (CLI, Code Assist)
- Cursor, Cline, Windsurf, VS Code Copilot
- and use Remote MCP with any other MCP-compatible client

## Features

Remote MCP server that enables all Claude clients (Desktop, Code, Mobile) to access the same self-hosted ChromaDB instance.

- **Shared Memory Across Devices** - All Claude clients use the same ChromaDB instance
- **Self-Hosted & Private** - Your data stays on your infrastructure
- **Remote Access** - Connect from anywhere via Tailscale or public internet
- **Complete ChromaDB Support** - All CRUD operations via MCP tools
- **REST API Proxy** - Direct ChromaDB access for Python/JavaScript
- **Unified Authentication** - Single token protects both MCP and REST API endpoints
- **Easy Deployment** - One-command installation with Docker

---

## Architecture

### Overview

```
┌──────────────────────────────┐      ┌──────────────┐
│   Claude Desktop + Mobile    │      │  Claude Code │
│  (Custom Connector - synced) │      │  (CLI setup) │
└──────────────┬───────────────┘      └──────┬───────┘
               │                             │
               │     MCP Remote Connector    │
               └─────────────┬───────────────┘
                             │ HTTPS
                   ┌─────────▼──────────┐
                   │   Remote MCP       │
                   │   Server (Node.js) │
                   │                    │
                   │ • Auth Gateway     │
                   │ • MCP Protocol     │
                   │ • REST API Proxy   │
                   └─────────┬──────────┘
                             │
                   ┌─────────▼──────────┐
                   │     ChromaDB       │
                   │ (Vector Database)  │
                   │                    │
                   │ • Embeddings       │
                   │ • Collections      │
                   │ • Semantic Search  │
                   └────────────────────┘

```

**How Clients Connect:**

- **Claude Desktop + Mobile**: Set up once using custom connector in Claude Desktop, and it automatically syncs to the mobile app. Both share the same connection automatically.
- **Claude Code**: Requires separate setup using `claude mcp add` CLI command.

All clients access the same self-hosted ChromaDB through this remote MCP server. Vector embeddings and semantic search results persist across all platforms.

### API Endpoints

| Path            | Purpose           | Client                     | Authentication |
| --------------- | ----------------- | -------------------------- | -------------- |
| `/mcp`          | MCP Protocol      | Claude Desktop/Code/Mobile | ✅             |
| `/api/v2/*`     | ChromaDB REST API | Python                     | ✅             |
| `/docs`         | Swagger UI        | Browser (API docs)         | ✅             |
| `/openapi.json` | OpenAPI Spec      | API tools                  | ✅             |
| `/health`       | Health check      | Monitoring                 | ❌             |

### How It Works

1. **Claude Desktop/Mobile**: Add MCP server via custom connector (syncs automatically between devices)
2. **Claude Code**: Add MCP server using `claude mcp add` CLI command
3. **Remote MCP Server** authenticates requests and translates MCP protocol to ChromaDB operations
4. **ChromaDB** stores and retrieves vector embeddings for semantic search
5. **Python** can also access ChromaDB directly via the proxied REST API

**Benefits:**

- Same vector database across all clients
- Desktop and mobile share connection automatically
- Self-hosted and private
- Persistent memory across app restarts
- Single source of truth for embeddings

---

## Quick Start

### One-Command Installation

```bash
curl -fsSL https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/scripts/install.sh | bash
```

This will:

1. Download `docker-compose.yml` and `.env.example`
2. Auto-detect Docker Compose command (`docker-compose` or `docker compose`)
3. Auto-generate a secure authentication token (optional)
4. Configure ChromaDB data storage location (Docker volume, local directory, or custom path)
5. Pull Docker images
6. Display your authentication token and connection URL

### Manual Installation

#### Option 1: Docker (Recommended - Pre-built Image)

```bash
# Download configuration files
mkdir chromadb-remote-mcp && cd chromadb-remote-mcp
curl -O https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/docker-compose.yml
curl -O https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/.env.example

# Configure environment
cp .env.example .env
# Edit .env and set:
#   - MCP_AUTH_TOKEN (see token generation below)
#   - PORT (default: 8080)
#   - CHROMA_DATA_PATH (default: chroma-data)

# Start services
docker compose up -d
# or: docker-compose up -d (for older versions)

# Check health
curl http://localhost:8080/health

# View logs
docker compose logs -f
```

#### Option 2: Build from Source

```bash
# Clone repository
git clone https://github.com/meloncafe/chromadb-remote-mcp.git
cd chromadb-remote-mcp

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Start with docker-compose (builds image from source)
docker compose -f docker-compose.dev.yml up -d
# or: docker-compose -f docker-compose.dev.yml up -d (for older versions)
```

#### Option 3: Local Development

```bash
# Clone and install
git clone https://github.com/meloncafe/chromadb-remote-mcp.git
cd chromadb-remote-mcp
yarn install

# Configure environment
cp .env.example .env
# Edit .env file

# Build and run
yarn build
yarn start
```

### Generate Secure Token

For production use, generate a secure token for `MCP_AUTH_TOKEN` in `.env`:

```bash
# Method 1: Node.js (Recommended)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# Method 2: OpenSSL
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Copy the generated token and paste it into your `.env` file:

```env
MCP_AUTH_TOKEN=your-generated-token-here
```

### Server Endpoints

- MCP: `http://localhost:8080/mcp` (via Caddy proxy)
- Health: `http://localhost:8080/health`
- ChromaDB API: `http://localhost:8080/api/v2/*`
- Swagger UI: `http://localhost:8080/docs`

---

## Configuration

### Environment Variables (.env file)

All configuration is done through the `.env` file. Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

| Variable            | Description                                                          | Default            | Required                    |
| ------------------- | -------------------------------------------------------------------- | ------------------ | --------------------------- |
| `PORT`              | External port (Caddy reverse proxy)                                  | `8080`             | No                          |
| `CHROMA_DATA_PATH`  | ChromaDB data storage path (volume name, `./data`, or absolute path) | `chroma-data`      | No                          |
| `CHROMA_HOST`       | ChromaDB host (internal)                                             | `chromadb`         | No                          |
| `CHROMA_PORT`       | ChromaDB port (internal)                                             | `8000`             | No                          |
| `CHROMA_TENANT`     | ChromaDB tenant                                                      | `default_tenant`   | No                          |
| `CHROMA_DATABASE`   | ChromaDB database                                                    | `default_database` | No                          |
| `MCP_AUTH_TOKEN`    | Authentication token for MCP and REST API                            | -                  | **Yes** (for public access) |
| `CHROMA_AUTH_TOKEN` | ChromaDB auth token (if ChromaDB requires auth)                      | -                  | No                          |
| `RATE_LIMIT_MAX`    | Max requests per IP per 15 minutes                                   | `100`              | No                          |
| `ALLOWED_ORIGINS`   | Comma-separated list of allowed origins (DNS rebinding protection)   | -                  | No                          |
| `ALLOW_QUERY_AUTH`  | Enable authentication via query parameters (`?apiKey=TOKEN`)         | `true`             | No                          |

### Authentication

**IMPORTANT:** For public internet access (Tailscale Funnel, Cloudflare Tunnel, etc.), you **must** set `MCP_AUTH_TOKEN` in your `.env` file.

Generate a secure token:

```bash
# Method 1: Node.js (Recommended - from .env.example)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# Method 2: OpenSSL
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Edit your `.env` file:

```env
MCP_AUTH_TOKEN=your-generated-token-here
```

Then restart the services:

```bash
docker compose restart
# or: docker-compose restart
```

**Supported authentication methods:**

1. **Authorization Header** (Most Secure): `Authorization: Bearer TOKEN`

   - Recommended for API clients and automated tools
   - Compliant with MCP specification
   - Example: `curl -H "Authorization: Bearer YOUR_TOKEN"`

2. **X-Chroma-Token Header**: `X-Chroma-Token: TOKEN`

   - For ChromaDB Python/JavaScript libraries
   - Compatible with ChromaDB client SDKs
   - Example: `client = chromadb.HttpClient(headers={"X-Chroma-Token": "TOKEN"})`

3. **Query Parameter** (Default Enabled): `?apiKey=TOKEN`
   - **Required for Claude Desktop Custom Connector**
   - Enables browser-based integrations
   - Enabled by default (`ALLOW_QUERY_AUTH=true`)
   - Set `ALLOW_QUERY_AUTH=false` to disable if not needed

### Origin Header Validation (DNS Rebinding Protection)

The server validates the `Origin` header for browser requests to prevent DNS rebinding attacks. This security feature is enabled by default and protects your local MCP server from malicious websites.

**Default allowed origins (always permitted):**

- **Localhost variants**: `localhost`, `127.0.0.1`, `[::1]`
- **Claude.ai domains**: `https://claude.ai`, `https://api.anthropic.com`

**Configure additional allowed origins:**

If you need to allow additional web applications or custom domains, add them to `ALLOWED_ORIGINS` in your `.env` file:

```env
# Add additional custom domains (Claude.ai is already allowed by default)
ALLOWED_ORIGINS=https://myapp.com,https://yourdomain.com
```

**When to configure ALLOWED_ORIGINS:**

- ✅ Using Claude Desktop Custom Connector → **No configuration needed** (allowed by default)
- ✅ Accessing from custom web applications → Add your application's domain
- ✅ Using Swagger UI remotely → Add your server's domain
- ❌ Using Claude Code CLI → Not needed (no Origin header)
- ❌ Using Python/JavaScript clients → Not needed (no Origin header)
- ❌ Local development only → Not needed (localhost is allowed by default)

**Example configurations:**

```env
# For custom web application
ALLOWED_ORIGINS=https://myapp.com,https://app.mycompany.com

# Multiple custom domains (comma-separated, spaces are trimmed)
ALLOWED_ORIGINS=https://myapp.com, https://api.example.com, https://dashboard.mycompany.com

# Leave empty if you only need Claude.ai and localhost
ALLOWED_ORIGINS=
```

**Note:** Claude.ai domains (`https://claude.ai`, `https://api.anthropic.com`) and localhost are always allowed, even if `ALLOWED_ORIGINS` is empty. Server-to-server requests (without Origin header) are always permitted.

### Data Storage Configuration

ChromaDB data can be stored in three ways:

1. **Docker volume (default)**: `CHROMA_DATA_PATH=chroma-data`

   - Managed by Docker
   - Survives container restarts
   - Use `docker volume ls` and `docker volume inspect chroma-data` to locate

2. **Local directory**: `CHROMA_DATA_PATH=./data`

   - Easy to backup and access
   - Stored in installation directory

3. **Custom path**: `CHROMA_DATA_PATH=/path/to/data`
   - Must be an absolute path
   - Useful for mounting external storage

After changing `CHROMA_DATA_PATH`, restart the services:

```bash
docker compose restart
```

---

## Connecting Claude

### Claude Desktop + Mobile

**Method 1: Custom Connector (Recommended - Pro/Team/Enterprise)**

1. Open Claude Desktop → Settings → Integrations → Custom Connector
2. Click "Add Custom Server"
3. Enter:
   - **Name**: `ChromaDB`
   - **URL**: `https://your-server.com/mcp?apiKey=YOUR_TOKEN`

> **Note**: Custom connector automatically syncs to the mobile app. Authentication is mandatory for remote access.

**Method 2: mcp-remote Wrapper (Free/Pro Users)**

If you don't have access to Custom Connectors, use the `mcp-remote` package as a workaround:

**Configuration file location:**

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Add to configuration file:**

```json
{
  "mcpServers": {
    "chromadb": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-server.com/mcp?apiKey=YOUR_TOKEN"]
    }
  }
}
```

Restart Claude Desktop after editing the file.

> **Important**: Remote MCP servers cannot be configured directly in `claude_desktop_config.json` using `streamableHttp` transport. You must either use Custom Connectors or the `mcp-remote` wrapper package.

### Claude Code

**CLI Command:**

```bash
# Without authentication
claude mcp add --transport http chromadb https://your-server.com/mcp

# With authentication (Query Parameter - Recommended)
claude mcp add --transport http chromadb https://your-server.com/mcp?apiKey=YOUR_TOKEN

# With authentication (Header)
claude mcp add --transport http chromadb https://your-server.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"

# Verify
claude mcp list
```

---

## Available Tools

The MCP server provides these tools for Claude:

### Collection Management

- `chroma_list_collections` - List all collections
- `chroma_create_collection` - Create a new collection
- `chroma_delete_collection` - Delete a collection
- `chroma_get_collection_info` - Get collection metadata
- `chroma_get_collection_count` - Get document count
- `chroma_peek_collection` - Preview collection contents

### Document Operations

- `chroma_add_documents` - Add documents with embeddings
- `chroma_query_documents` - Semantic search (vector similarity)
- `chroma_get_documents` - Retrieve documents by ID or filter
- `chroma_update_documents` - Update existing documents
- `chroma_delete_documents` - Delete documents

---

## Using ChromaDB from Python

The MCP server proxies all ChromaDB REST API endpoints, allowing direct access from Python clients.

### Python Example

```python
import chromadb

# HTTPS (Tailscale Funnel, public deployment)
client = chromadb.HttpClient(
    host="your-server.com",
    port=443,
    ssl=True,
    headers={
        "X-Chroma-Token": "YOUR_TOKEN"
    }
)

# Local development (HTTP)
client = chromadb.HttpClient(
    host="localhost",
    port=8080,
    ssl=False,
    headers={
        "X-Chroma-Token": "YOUR_TOKEN"
    }
)

# Usage
collection = client.create_collection("my_collection")
collection.add(
    documents=["Document 1", "Document 2"],
    ids=["id1", "id2"]
)
results = collection.query(query_texts=["query"], n_results=2)
```

Alternative authentication:

```python
from chromadb.config import Settings

client = chromadb.HttpClient(
    host="your-server.com",
    port=443,
    ssl=True,
    settings=Settings(
        chroma_client_auth_provider="chromadb.auth.token_authn.TokenAuthClientProvider",
        chroma_client_auth_credentials="YOUR_TOKEN"
    )
)
```

### API Documentation

Visit `https://your-server.com/docs` for Swagger UI documentation of all ChromaDB REST API endpoints.

---

## Deployment

### Option 1: Tailscale VPN (Recommended)

**Secure access within your Tailscale network:**

```bash
# Start services
docker compose up -d

# Enable Tailscale Serve (HTTPS with automatic certificates)
tailscale serve https / http://127.0.0.1:8080

# Check status
tailscale serve status
```

Your server is now accessible at `https://your-machine.tailXXXXX.ts.net` to all devices in your Tailnet.

**Advantages:**

- Automatic HTTPS certificates
- No public internet exposure
- Encrypted VPN tunnel
- Authentication optional (VPN provides security layer)

### Option 2: Tailscale Funnel (Public Internet)

**To use Claude Desktop UI Custom Connector or share publicly:**

```bash
# Enable Funnel (allows public internet access)
tailscale funnel 8080 on
tailscale serve https / http://127.0.0.1:8080

# Verify Funnel is active
tailscale serve status  # Should show "Funnel on"
```

> **Warning**: This exposes your server to the public internet. **Authentication is mandatory!** Set `MCP_AUTH_TOKEN` in your environment.

**Disable Funnel:**

```bash
tailscale funnel 8080 off
```

### Option 3: Cloudflare Tunnel

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared

# Authenticate
./cloudflared tunnel login

# Create tunnel
./cloudflared tunnel create chroma-mcp

# Run tunnel
./cloudflared tunnel --url http://localhost:3000
```

### Option 4: Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Security

### Code Quality & Security Analysis

This project follows strict security practices and has resolved all security issues identified by static analysis:

- ✅ **Zero Active Issues**: All OWASP and CWE security findings have been resolved
- 🔒 **Static Analysis**: Continuous monitoring with [DeepSource](https://app.deepsource.com/report/1328a083-a457-4598-b56f-e64dafdbcc28)
- 🛡️ **Security Standards**: Compliant with OWASP Top 10 and Node.js security best practices
- 📊 **Automated Scanning**: Dependabot, CodeQL, and container vulnerability scanning

For detailed security information, see [Security Policy](SECURITY.md).

### Security Recommendations

1. **Enable Authentication for Public Access**

   - Set `MCP_AUTH_TOKEN` when using Tailscale Funnel or public internet
   - Generate strong tokens: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`
   - Rotate tokens regularly

2. **Use HTTPS**

   - Tailscale provides automatic HTTPS certificates
   - Use reverse proxy (Nginx/Caddy) with Let's Encrypt for other deployments

3. **Prefer VPN Over Public Internet**

   - Tailscale Serve (VPN-only) is more secure than Funnel (public)
   - Authentication is optional within VPN but mandatory for public access

4. **Monitor Access**

   ```bash
   # Check for unauthorized access attempts
   docker compose logs mcp-server | grep "Unauthorized"
   ```

5. **Network Isolation**
   - Keep ChromaDB on private network
   - Only expose MCP server to public internet

---

## Testing

### Local Testing

```bash
# Health check
curl http://localhost:3000/health

# MCP tools list
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# ChromaDB heartbeat
curl http://localhost:3000/api/v2/heartbeat
```

### Remote Testing (with authentication)

```bash
# MCP endpoint (Bearer token)
curl -X POST https://your-server.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# MCP endpoint (Query parameter)
curl -X POST "https://your-server.com/mcp?apiKey=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# ChromaDB REST API
curl https://your-server.com/api/v2/heartbeat \
  -H "X-Chroma-Token: YOUR_TOKEN"

# Swagger UI (browser)
https://your-server.com/docs?apiKey=YOUR_TOKEN
```

---

## Troubleshooting

### ChromaDB Connection Failed

```bash
# Check if ChromaDB is running
curl http://localhost:8000/api/v2/heartbeat

# Start ChromaDB with Docker
docker run -d -p 8000:8000 chromadb/chroma:latest

# Check MCP server logs
docker compose logs mcp-server
```

### MCP Server Not Responding

```bash
# Check logs
docker compose logs mcp-server

# Check port conflicts
lsof -i :3000

# Restart services
docker compose restart
```

### Claude Desktop Connection Issues

1. Restart Claude Desktop
2. Verify URL includes `/mcp` path
3. Confirm transport type is `streamableHttp` (not `sse`)
4. Check authentication token if enabled
5. For Custom Connector: Ensure Tailscale Funnel is active

### TLS Handshake Timeout on Local Network

If you're connecting from the same local network as the server and using Tailscale Funnel HTTPS:

**Problem**: TLS handshake fails with timeout when accessing `https://your-server.ts.net` from the same network.

**Root cause**: Tailscale Funnel has issues with TLS termination when clients on the same LAN try to connect via the public Funnel domain.

**Solution**: Use direct local network connection instead of Tailscale HTTPS:

```bash
# Remove existing configuration
claude mcp remove chromadb

# Add with local IP address
claude mcp add chromadb --transport http \
  http://192.168.x.x:8080/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"

# Or use hostname if DNS resolves
claude mcp add chromadb --transport http \
  http://server-hostname:8080/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

**Verification**:
```bash
# Test local network connection
curl http://192.168.x.x:8080/health

# Should return: {"status":"ok","service":"chroma-remote-mcp",...}
```

**Note**: External clients should continue using Tailscale Funnel HTTPS. This issue only affects clients on the same LAN as the server.

### Authentication Errors (401)

```bash
# Verify MCP_AUTH_TOKEN is set
docker compose exec mcp-server env | grep MCP_AUTH_TOKEN

# Test without token (should fail with 401)
curl -X POST https://your-server.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Test with correct token (should succeed)
curl -X POST https://your-server.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/meloncafe/chromadb-remote-mcp.git
cd chromadb-remote-mcp

# Install dependencies
yarn install

# Development mode (auto-reload)
yarn dev

# Build TypeScript
yarn build

# Type check
yarn type-check
```

### Testing

The project includes integration tests with Docker-based E2E validation:

```bash
# Run all tests (starts services, runs tests, cleans up)
yarn test

# Run tests and keep containers running for debugging
yarn test:keep

# Manual test script with options
./scripts/test.sh --help
```

**Integration Test Coverage:**

- ✅ Health check endpoint
- ✅ Authentication (Bearer token, X-Chroma-Token, query parameter)
- ✅ MCP protocol (tools/list, tools/call)
- ✅ ChromaDB REST API proxy
- ✅ Collection CRUD operations
- ✅ Rate limiting
- ✅ Unauthorized access handling

**Unit Tests:**

```bash
# Run unit tests
yarn test:unit

# Run with watch mode
yarn test:unit:watch

# Run with coverage
yarn test:unit:coverage

# Run all tests (unit + integration)
yarn test:all
```

**Unit Test Coverage:**

- ✅ Authentication utilities (timing-safe comparison, buffer operations)
- ✅ Input validation (collection names, document IDs, metadata)
- ✅ Data processing (response formatting, JSON serialization)
- ✅ Error message formatting

See `__tests__/README.md` for detailed testing strategy.

### Code Quality & Coverage

This project uses [Codecov](https://codecov.io/gh/meloncafe/chromadb-remote-mcp) for code coverage tracking and test analytics.

### Docker Development

#### Local Build and Test

```bash
# Build for local testing (single platform, loads to Docker)
yarn docker:build:local

# Or with script directly
./scripts/build.sh --platform linux/amd64 --load

# Test the built image
docker run -p 3000:3000 \
  -e MCP_AUTH_TOKEN=test123 \
  devsaurus/chromadb-remote-mcp:latest
```

#### Multi-Platform Build

```bash
# Build for all platforms (amd64, arm64)
yarn docker:build

# Build with custom version
./scripts/build.sh --version 1.2.3

# Build with custom repository
./scripts/build.sh --repo myuser/my-mcp --version dev
```

#### Push to Docker Hub

```bash
# Push latest tag
yarn docker:push

# Push specific version
VERSION=1.2.3 yarn docker:push

# Or with script directly
./scripts/build.sh --version 1.2.3 --push

# With custom repository
DOCKER_REPO=myuser/my-mcp ./scripts/build.sh --version 1.2.3 --push
```

**Environment Variables for Docker Scripts:**

```bash
export DOCKER_REPO=myuser/my-mcp       # Docker repository
export VERSION=1.2.3                    # Image version tag
export DOCKER_USERNAME=myuser           # For push authentication
export DOCKER_PASSWORD=mytoken          # Docker Hub token
```

### Development Scripts

All development scripts are located in `scripts/`:

| Script       | Purpose                      | Usage                       |
| ------------ | ---------------------------- | --------------------------- |
| `build.sh`   | Build and push Docker images | `./scripts/build.sh --help` |
| `test.sh`    | Run integration tests        | `./scripts/test.sh --help`  |
| `install.sh` | One-command installation     | `curl ... \| bash`          |

**Quick Development Workflow:**

```bash
# 1. Make code changes
vim src/index.ts

# 2. Test locally
yarn dev

# 3. Run integration tests
yarn test

# 4. Build Docker image
yarn docker:build:local

# 5. Test Docker image
docker-compose up

# 6. If all good, build multi-platform and push
./scripts/build.sh --version 1.2.3 --push
```

### Project Structure

```
chromadb-remote-mcp/
├── .github/
│   ├── ISSUE_TEMPLATE/       # GitHub issue templates
│   └── workflows/            # GitHub Actions (publish-release, security-scan, chromadb-version-check)
├── scripts/
│   ├── build.sh             # Docker build and push script (multi-platform)
│   ├── test.sh              # Integration test runner
│   └── install.sh           # One-command installation
├── src/
│   ├── index.ts             # Main server entry point
│   ├── chroma-tools.ts      # MCP tool definitions and handlers
│   └── types.ts             # TypeScript type definitions
├── docker-compose.yml       # Production (prebuilt image)
├── docker-compose.dev.yml   # Development (builds from source)
├── Dockerfile               # MCP server Docker image
├── .env.example             # Environment variables template
├── package.json             # Node.js dependencies
├── tsconfig.json            # TypeScript configuration
├── SECURITY.md              # Security policy
├── CONTRIBUTING.md          # Contribution guidelines
├── CODE_OF_CONDUCT.md       # Code of conduct
├── CHANGELOG.md             # Version history
└── LICENSE                  # MIT license
```

---

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

[MIT License](LICENSE)

---

## Resources

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [ChromaDB Documentation](https://docs.trychroma.com/)
- [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve/)
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

---

## Support

If you encounter any issues or have questions, please [open an issue](https://github.com/meloncafe/chromadb-remote-mcp/issues).
