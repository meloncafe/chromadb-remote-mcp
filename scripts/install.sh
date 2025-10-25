#!/bin/bash
set -e

echo "🚀 ChromaDB Remote MCP Server - Installation Script"
echo "=================================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

# Detect Docker Compose command
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
    echo "✅ Using docker-compose"
elif docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
    echo "✅ Using docker compose"
else
    echo "❌ Docker Compose is not installed. Please install Docker Compose first:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

# Create installation directory
INSTALL_DIR="${1:-$PWD/chromadb-remote-mcp}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "📁 Installation directory: $INSTALL_DIR"
echo ""

# Download docker-compose.yml
echo "📥 Downloading docker-compose.yml..."
curl -fsSL -o docker-compose.yml \
    https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/docker-compose.yml

# Download .env.example
echo "📥 Downloading .env.example..."
curl -fsSL -o .env.example \
    https://raw.githubusercontent.com/meloncafe/chromadb-remote-mcp/release/.env.example

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env

    echo ""
    echo "🔑 Authentication Token Configuration"
    echo "======================================"
    read -p "Would you like to auto-generate a secure token? (Y/n): " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        # Try to generate token with Node.js first
        if command -v node &> /dev/null; then
            TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
            echo "✅ Token generated using Node.js"
        elif command -v openssl &> /dev/null; then
            TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
            echo "✅ Token generated using OpenSSL"
        else
            echo "⚠️  Neither Node.js nor OpenSSL found. Please set MCP_AUTH_TOKEN manually in .env"
            TOKEN=""
        fi

        if [ -n "$TOKEN" ]; then
            # Update .env file with generated token
            if [[ "$OSTYPE" == "darwin"* ]]; then
                # macOS
                sed -i '' "s/^MCP_AUTH_TOKEN=$/MCP_AUTH_TOKEN=$TOKEN/" .env
            else
                # Linux
                sed -i "s/^MCP_AUTH_TOKEN=$/MCP_AUTH_TOKEN=$TOKEN/" .env
            fi

            echo ""
            echo "✅ Token has been set in .env file"
            SHOW_TOKEN_LATER="yes"
        fi
    else
        echo ""
        echo "⚠️  Please set MCP_AUTH_TOKEN manually in .env file"
        echo ""
        echo "   Generate a secure token:"
        echo "   node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\""
        echo "   OR"
        echo "   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='"
    fi

    echo ""
    echo "💾 ChromaDB Data Storage Configuration"
    echo "======================================="
    echo "Where should ChromaDB store its data?"
    echo ""
    echo "Options:"
    echo "  1) Docker volume (default) - Managed by Docker"
    echo "  2) Current directory (./data) - Easy to backup/access"
    echo "  3) Custom path - Specify your own path"
    echo ""
    read -p "Select option (1-3) [1]: " -n 1 -r DATA_OPTION
    echo ""
    echo ""

    case $DATA_OPTION in
        2)
            DATA_PATH="./data"
            mkdir -p "$INSTALL_DIR/data"
            echo "✅ Using local directory: $INSTALL_DIR/data"
            ;;
        3)
            read -p "Enter custom path (absolute path): " CUSTOM_PATH
            if [[ "$CUSTOM_PATH" == /* ]]; then
                DATA_PATH="$CUSTOM_PATH"
                mkdir -p "$CUSTOM_PATH"
                echo "✅ Using custom path: $CUSTOM_PATH"
            else
                echo "⚠️  Invalid path (must be absolute). Using default docker volume."
                DATA_PATH="chroma-data"
            fi
            ;;
        *)
            DATA_PATH="chroma-data"
            echo "✅ Using Docker volume: chroma-data"
            ;;
    esac

    # Update .env file with data path
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|^CHROMA_DATA_PATH=.*|CHROMA_DATA_PATH=$DATA_PATH|" .env
    else
        # Linux
        sed -i "s|^CHROMA_DATA_PATH=.*|CHROMA_DATA_PATH=$DATA_PATH|" .env
    fi

    echo ""
else
    echo "✅ .env file already exists, skipping..."
fi

echo ""
echo "🐳 Pulling Docker images..."
$DOCKER_COMPOSE pull

echo ""
echo "✅ Installation complete!"
echo ""

if [ -n "$SHOW_TOKEN_LATER" ] && [ -n "$TOKEN" ]; then
    echo "🔐 Your Authentication Token"
    echo "============================"
    echo ""
    echo "  $TOKEN"
    echo ""
    echo "⚠️  IMPORTANT: Save this token securely!"
    echo "   You'll need it to connect Claude clients to this server."
    echo ""
    echo "   Example MCP URL:"
    echo "   https://your-domain.com/mcp?apiKey=$TOKEN"
    echo ""
fi

echo "To start the server:"
echo "  cd $INSTALL_DIR"
echo "  $DOCKER_COMPOSE up -d"
echo ""
echo "To view logs:"
echo "  $DOCKER_COMPOSE logs -f"
echo ""
echo "To stop the server:"
echo "  $DOCKER_COMPOSE down"
echo ""
echo "📖 For more information, visit:"
echo "   https://github.com/meloncafe/chromadb-remote-mcp"
