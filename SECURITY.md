# Security Policy

English | [한국어](SECURITY.ko.md)

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of ChromaDB Remote MCP Server seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report a Security Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via:

1. **GitHub Security Advisories**: Go to the [Security tab](https://github.com/meloncafe/chromadb-remote-mcp/security/advisories) and click "Report a vulnerability"
2. **Email**: Send an email to the maintainers through GitHub profile contacts

Please include the following information in your report:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

### What to Expect

- **Acknowledgment**: We will acknowledge your email within 48 hours
- **Communication**: We will keep you informed about the progress of fixing the vulnerability
- **Credit**: We will credit you in the security advisory (unless you prefer to remain anonymous)
- **Timeline**: We aim to fix critical vulnerabilities within 7 days, and other vulnerabilities within 30 days

## Security Best Practices

When deploying ChromaDB Remote MCP Server:

### 1. Authentication

- **Always** set `MCP_AUTH_TOKEN` when exposing the server to the public internet
- Use strong, randomly generated tokens (minimum 32 bytes)
- Rotate tokens regularly (recommended: every 90 days)
- Never commit tokens to version control

Generate secure tokens:

```bash
# Method 1: Node.js (Recommended)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# Method 2: OpenSSL
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

### 2. Network Security

- **Use HTTPS**: Always use HTTPS in production (Tailscale, reverse proxy, etc.)
- **VPN First**: Prefer Tailscale Serve (VPN-only) over Funnel (public internet)
- **Firewall**: Restrict access to known IP addresses when possible
- **Docker Network**: Keep ChromaDB on a private Docker network

### 3. Docker Security

- Keep Docker images up to date: `docker compose pull && docker compose up -d`
- Use specific version tags instead of `latest` in production
- Run containers with minimal privileges
- Regularly review container logs for suspicious activity

### 4. Data Protection

- **Backup**: Regularly backup ChromaDB data (see `CHROMA_DATA_PATH`)
- **Encryption at Rest**: Use encrypted volumes for sensitive data
- **Access Control**: Limit file system access to the data directory

### 5. Monitoring

```bash
# Monitor authentication failures
docker compose logs mcp-server | grep "Unauthorized"

# Check for unusual traffic patterns
docker compose logs caddy | grep -E "POST /mcp"

# Monitor resource usage
docker stats
```

## Known Security Considerations

### Authentication Token in URL

When using query parameter authentication (`?apiKey=TOKEN`), be aware that:

- Tokens may appear in server logs
- Tokens may be cached in browser history
- Consider using header-based authentication for better security

### ChromaDB Security

- ChromaDB runs without authentication in the default configuration
- The MCP server acts as an authentication gateway
- ChromaDB is not directly exposed to the internet
- Only the MCP server (with authentication) is publicly accessible

### Rate Limiting

- The server includes built-in rate limiting (100 requests per 15 minutes per IP)
- Adjust limits via environment variables if needed
- Consider additional rate limiting at the reverse proxy level

## Security Updates

- **Watch this repository** to receive notifications about security updates
- **Enable Dependabot alerts** in your fork to track dependency vulnerabilities
- **Subscribe to releases** to stay informed about security patches

## Compliance

This project follows security best practices from:

- OWASP Top 10
- Docker Security Best Practices
- Node.js Security Best Practices
- Model Context Protocol Security Guidelines

## Contact

For security-related questions that are not vulnerabilities, please:

- Open an issue in [GitHub Issues](https://github.com/meloncafe/chromadb-remote-mcp/issues)
- Check existing issues and documentation

## Disclosure Policy

We follow responsible disclosure principles:

1. Security issue is reported privately
2. We investigate and develop a fix
3. We release the fix in a new version
4. We publish a security advisory 7 days after the fix is available
5. We credit the reporter (with permission)

## CVE Assignment

For vulnerabilities meeting the following criteria, we will request a CVE ID:

- **Critical/High Severity**: Authentication bypass, remote code execution, data exposure
- **Wide Impact**: Affects all users of a supported version
- **Publicly Exploitable**: Requires no special access or configuration

CVE requests will be made through:

- GitHub Security Advisories
- MITRE CVE Request Form (as backup)

## Security Features

### Content Security Policy (CSP)

The server implements a strict Content Security Policy to prevent XSS and code injection attacks:

```
default-src 'none'           # Deny everything by default
script-src 'self'           # Only scripts from same origin
connect-src 'self'          # Only fetch/XHR to same origin
img-src 'self' data:        # Images from same origin + data URIs
style-src 'self' 'unsafe-inline'  # Styles (unsafe-inline for Swagger UI)
font-src 'self'             # Fonts from same origin
frame-ancestors 'none'      # Prevent iframe embedding
base-uri 'self'             # Restrict <base> tag
form-action 'self'          # Restrict form submissions
```

**Why `'unsafe-inline'` for styles?**

- Required for Swagger UI documentation interface
- Styles are still restricted to same-origin
- Trade-off between security and functionality

### Other Security Headers

- **X-Frame-Options**: `DENY` - Prevent clickjacking
- **X-Content-Type-Options**: `nosniff` - Prevent MIME sniffing
- **Referrer-Policy**: `strict-origin-when-cross-origin` - Don't leak sensitive URLs
- **Permissions-Policy**: Restrict browser features (geolocation, microphone, camera)
- **HSTS**: `max-age=31536000; includeSubDomains` - Force HTTPS (when behind proxy)

## Security Scanning

This project uses automated security scanning:

- **Dependabot**: Automatic dependency vulnerability alerts
- **CodeQL**: Static application security testing (SAST)
- **Container Scanning**: Docker image vulnerability scanning
- **DeepSource**: Continuous code quality and security analysis
- **Manual Review**: Code changes reviewed for security implications

### Static Analysis Results

All security issues identified by static analysis have been resolved:

- ✅ **OWASP Vulnerabilities**: Zero active issues
- ✅ **CWE Findings**: All findings addressed and fixed
- ✅ **Code Quality**: Meets industry standards and best practices

View the latest analysis report: [DeepSource Public Report](https://app.deepsource.com/report/1c2f3d5c-df61-4e60-b20c-5a82adc729f7)

> **Note**: The report link may change when code is updated or monthly. Check the repository badges for the current status.

Thank you for helping keep ChromaDB Remote MCP Server and our users safe!
