# Antigravity Cloud Hub

Antigravity Cloud Hub is the central registry, authentication, management, and telemetry control plane for Google Antigravity extensions, plugins, and skills.

## Features

- **Registry & Distribution**: Host and distribute plugins and skills with cryptographic verification (SHA-256 integrity checks, tarball packaging, and semver tracking).
- **Authentication & RBAC**: JWT + HTTP-only cookies, granular API key authentication (`agy_...`), and strict last-admin lockout prevention.
- **Telemetry Ingestion & Aggregation**: Real-time token consumption tracking, cost estimation ($ USD), latency/TTFT monitoring, and automated daily rollups.
- **Modern Web Dashboard**: Responsive React + Vite + Tailwind CSS management UI for monitoring plugins, skills, tokens, users, and API keys.
- **Production Hardened**: Native systemd integration on Ubuntu 24.04 LTS, TLS reverse proxy with Caddy, and PostgreSQL 16 persistence.

## Architecture

- **Backend**: Node.js 22 LTS, TypeScript, Express, Drizzle ORM, PostgreSQL 16.
- **Frontend**: React 18, Vite, Tailwind CSS, Lucide icons.
- **Database**: PostgreSQL 16 with pgcrypto and SCRAM-SHA-256 authentication over TLS.
- **Reverse Proxy**: Caddy with automated HTTPS (Let's Encrypt / ZeroSSL) via SNI.

## Development

```bash
# Install dependencies
npm install
cd web && npm install && cd ..

# Build backend and frontend
npm run build

# Run unit tests
npm test

# Start development server
npm run dev
```

## Production Deployment

```bash
# Start production server
npm start
```

## License

Private / Proprietary.
