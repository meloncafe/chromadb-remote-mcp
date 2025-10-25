# Contributing to ChromaDB Remote MCP Server

English | [한국어](CONTRIBUTING.ko.md)

Thank you for your interest in contributing to ChromaDB Remote MCP Server! We welcome contributions from the community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the [existing issues](https://github.com/meloncafe/chromadb-remote-mcp/issues) to avoid duplicates.

When creating a bug report, please include:

- A clear and descriptive title
- Detailed steps to reproduce the issue
- Expected behavior vs actual behavior
- Your environment (OS, Docker version, etc.)
- Relevant logs (see `.github/ISSUE_TEMPLATE/bug_report.md`)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- Use a clear and descriptive title
- Provide a detailed description of the proposed enhancement
- Explain why this enhancement would be useful
- List any alternatives you've considered

### Contributing Code

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test your changes
5. Commit your changes (see [Commit Messages](#commit-messages))
6. Push to your fork (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- Yarn >= 1.22.22
- Docker and Docker Compose (for testing)
- Git

### Local Development

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/chromadb-remote-mcp.git
cd chromadb-remote-mcp

# Install dependencies
yarn install

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration

# Start ChromaDB (in another terminal)
docker run -d -p 8000:8000 chromadb/chroma:latest

# Development mode with auto-reload
yarn dev

# Build TypeScript
yarn build

# Run production build
yarn start
```

### Docker Development

```bash
# Start all services (ChromaDB + MCP Server)
docker compose -f docker-compose.dev.yml up

# View logs
docker compose -f docker-compose.dev.yml logs -f

# Rebuild after code changes
docker compose -f docker-compose.dev.yml up --build
```

## Pull Request Process

### Before Submitting

1. **Test your changes**: Ensure your code works as expected
2. **Type check**: Run `yarn type-check` to verify TypeScript types
3. **Build**: Run `yarn build` to ensure the code compiles
4. **Documentation**: Update README.md if needed
5. **Changelog**: Add your changes to CHANGELOG.md (under "Unreleased")

### PR Guidelines

- **One feature per PR**: Keep pull requests focused on a single feature or bug fix
- **Clear description**: Explain what changes you made and why
- **Link issues**: Reference related issues (e.g., "Fixes #123")
- **Small commits**: Make atomic commits with clear messages
- **Update tests**: Add or update tests for your changes (when applicable)

### PR Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update

## Testing

- [ ] Tested locally with Docker
- [ ] Tested with Claude Desktop
- [ ] Tested authentication methods
- [ ] Tested error cases

## Checklist

- [ ] My code follows the project's coding standards
- [ ] I have updated the documentation
- [ ] I have added/updated tests (if applicable)
- [ ] I have updated CHANGELOG.md
- [ ] All tests pass locally
```

## Coding Standards

### TypeScript Style

- Use TypeScript for all new code
- Enable strict type checking
- Prefer interfaces over type aliases for object shapes
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### Code Formatting

```typescript
// Good: Clear, typed, and documented
interface ChromaConfig {
  host: string;
  port: number;
  authToken?: string;
}

/**
 * Initialize ChromaDB client with configuration
 */
function initChromaClient(config: ChromaConfig): ChromaClient {
  return new ChromaClient(config);
}

// Bad: Untyped, unclear
function init(c: any) {
  return new ChromaClient(c);
}
```

### File Organization

```
src/
├── index.ts           # Main server entry point
├── chroma-tools.ts    # MCP tool definitions
├── types.ts           # TypeScript type definitions
└── utils/             # Utility functions (if needed)
```

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `security`: Security fixes

**Examples**:

```bash
feat(auth): add support for API key rotation
fix(proxy): handle ChromaDB connection timeout
docs(readme): update installation instructions
refactor(tools): simplify collection creation logic
security(auth): implement constant-time token comparison
```

## Testing

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Test MCP endpoint (without auth)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Test MCP endpoint (with auth)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Test ChromaDB proxy
curl http://localhost:3000/api/v2/heartbeat
```

### Integration Testing

Test with Claude Desktop:

```bash
# Start services
docker compose up -d

# Add to Claude Desktop config
claude mcp add --transport http chromadb http://localhost:8080/mcp

# Test in Claude Desktop
# Ask Claude: "List my ChromaDB collections"
```

## Documentation

### When to Update Documentation

Update documentation when you:

- Add a new feature
- Change existing behavior
- Add new configuration options
- Fix a bug that might affect users

### Documentation Files

- `README.md`: Main documentation (English)
- `SECURITY.md`: Security policies
- `CONTRIBUTING.md`: This file
- Code comments: For complex logic

### Writing Style

- Use clear, concise language
- Provide examples for complex features
- Keep line length under 120 characters
- Use code blocks with syntax highlighting
- Include screenshots for UI-related changes

## Project Structure

```
chromadb-remote-mcp/
├── .github/              # GitHub configurations
│   ├── ISSUE_TEMPLATE/  # Issue templates
│   └── workflows/       # GitHub Actions
├── src/                 # Source code
│   ├── index.ts        # Main server
│   ├── chroma-tools.ts # MCP tools
│   └── types.ts        # Type definitions
├── docker-compose.yml   # Production compose
├── docker-compose.dev.yml # Development compose
├── Dockerfile          # MCP server image
├── package.json        # Dependencies
├── tsconfig.json       # TypeScript config
├── .env.example        # Environment template
├── install.sh          # Installation script
├── README.md           # Documentation
├── SECURITY.md         # Security policy
├── CONTRIBUTING.md     # This file
├── CODE_OF_CONDUCT.md  # Code of conduct
├── CHANGELOG.md        # Version history
└── LICENSE             # MIT license
```

## Release Process

Releases are handled by maintainers:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create a git tag: `git tag -a v1.2.3 -m "Release v1.2.3"`
4. Push tag: `git push origin v1.2.3`
5. GitHub Actions automatically builds and publishes Docker image
6. Create GitHub release with changelog

## Getting Help

- **Documentation**: Check [README.md](README.md)
- **Questions**: Ask questions in [GitHub Issues](https://github.com/meloncafe/chromadb-remote-mcp/issues)

## Recognition

Contributors will be:

- Listed in release notes
- Credited in the project README (for significant contributions)
- Given credit in security advisories (for security reports)

Thank you for contributing to ChromaDB Remote MCP Server!
