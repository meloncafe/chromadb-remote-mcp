---
name: Bug Report
about: Report a bug or issue with ChromaDB Remote MCP Server
title: '[BUG] '
labels: bug
assignees: ''
---

> **Language / 언어**: You can write this issue in English or Korean (한국어 또는 영어로 작성 가능합니다)

## Bug Description

A clear and concise description of the bug.

## Environment

- OS: [e.g., Ubuntu 22.04, macOS 14.0]
- Docker version: [e.g., 24.0.0]
- Docker Compose version: [e.g., 2.20.0]
- ChromaDB Remote MCP version: [e.g., latest, v1.0.0]

## Steps to Reproduce

1.
2.
3.

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened.

## Screenshots

If applicable, please attach screenshots showing the issue or non-working functionality. Visual evidence helps us understand and reproduce the problem faster.

**Tip:** You can drag and drop images directly into the GitHub issue editor.

## Logs

<details>
<summary>Docker Compose Logs</summary>

```
Paste output of: docker compose logs
```

</details>

## Configuration

<details>
<summary>.env file (remove sensitive tokens)</summary>

```env
PORT=8080
CHROMA_DATA_PATH=chroma-data
MCP_AUTH_TOKEN=<REDACTED>
```

</details>

## Additional Context

Any other context about the problem.
