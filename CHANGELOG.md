# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2025-10-25

### Added

#### Core Features

- Remote MCP server with Streamable HTTP transport (2025-03-26 spec)
- ChromaDB integration with complete CRUD operations via MCP tools
- REST API proxy for direct ChromaDB access from Python/JavaScript clients
- Cross-platform support for Claude Desktop, Mobile, and Code

#### MCP Tools

- Collection management:

  - `chroma_list_collections`
  - `chroma_create_collection`
  - `chroma_delete_collection`
  - `chroma_get_collection_info`
  - `chroma_get_collection_count`
  - `chroma_peek_collection`

- Document operations:
  - `chroma_add_documents`
  - `chroma_query_documents`
  - `chroma_get_documents`
  - `chroma_update_documents`
  - `chroma_delete_documents`

#### Security

- Unified authentication system with three methods: Bearer token, X-Chroma-Token header, query parameter
- Rate limiting (100 requests per 15 minutes per IP, configurable)
- Strict Content Security Policy (CSP) with XSS and code injection protection
- Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS
- DNS rebinding attack prevention with Origin header validation
- Timing-safe token comparison to prevent timing attacks
- Log injection prevention with ANSI escape sequence filtering

#### Deployment

- One-command automated installation script
- Docker Compose configuration for production and development
- Multi-platform Docker images (linux/amd64, linux/arm64)
- Supply Chain Attestation (SBOM and Provenance) via Docker Scout
- GitHub Actions CI/CD pipeline with automated release workflow

#### Documentation

- [README](README.md) in English and Korean
- [Security Policy](SECURITY.md) in English and Korean
- [Contributing Guidelines](CONTRIBUTING.md) in English and Korean
- [Code of Conduct](CODE_OF_CONDUCT.md) in English and Korean

#### Testing & Quality

- Unit tests with 83% code coverage
- Real validation logic
- TypeScript strict mode with full type safety
- Automated security scanning (DeepSource, CodeQL, Dependabot, Docker Scout)

### Security

- Resolved all OWASP and CWE security findings (DeepSource verified)
- Achieved Docker Scout 8/8 compliance
- Zero active vulnerabilities in dependencies

[Unreleased]: https://github.com/meloncafe/chromadb-remote-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/meloncafe/chromadb-remote-mcp/releases/tag/v1.0.0
