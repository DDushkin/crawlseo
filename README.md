<div align="center">

<img src="docs/screenshots/logo.png" alt="CrawlSEO" width="80" />

# CrawlSEO

### Open-source SEO monitoring for founders, not SEO specialists

Google Search Console + Site Crawler + Core Web Vitals + MCP Server — all in one self-hosted dashboard. Free forever.

[![GitHub stars](https://img.shields.io/github/stars/crawlseo/crawlseo?style=flat-square)](https://github.com/crawlseo/crawlseo/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)
[![Docker](https://img.shields.io/badge/docker-ready-blue?style=flat-square&logo=docker)](docker-compose.yml)

</div>

---

<!-- TODO: Replace with actual screenshot -->
<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="CrawlSEO Dashboard" width="800" />
</p>

## Why CrawlSEO?

| | CrawlSEO | OpenSEO | Ahrefs | Semrush | Moz |
|---|:---:|:---:|:---:|:---:|:---:|
| **Price** | **Free** | $10/mo | €119/mo | $139/mo | $49/mo |
| **Self-hosted** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **GSC integration** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Site crawler** | ✅ (2000 pages) | ✅ | ✅ | ✅ | ✅ |
| **Core Web Vitals** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **MCP Server** | ✅ (10 tools) | ✅ (24 tools) | ❌ | ❌ | ❌ |
| **AI agent ready** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Keyword Research** | ✅ (BYOK) | ✅ | ✅ | ✅ | ✅ |
| **Backlinks** | ✅ (BYOK) | ✅ | ✅ | ✅ | ✅ |
| **Open source** | ✅ MIT | ✅ | ❌ | ❌ | ❌ |
| **Your data stays yours** | ✅ | ✅ | ❌ | ❌ | ❌ |

> **BYOK** = Bring Your Own Key. Keyword research and backlink data use DataForSEO (optional). Google Autocomplete suggestions work as a free fallback.

## Features

| | Feature | Description |
|---|---|---|
| 🔍 | **GSC Analytics** | Keywords, pages, clicks, impressions, position tracking with 28-day comparison |
| 🕷️ | **Site Crawler** | Crawl up to 2,000 pages with concurrent fetching, health score, and 16 issue types |
| ⚡ | **Core Web Vitals** | LCP, CLS, INP, TTFB via PageSpeed Insights with mobile/desktop comparison |
| 🤖 | **MCP Server** | 10 tools for Claude Code, Claude Desktop, and Cursor — query SEO data from your AI agent |
| 🔑 | **Keyword Research** | DataForSEO-powered keyword ideas with volume, difficulty, CPC. Free Google Autocomplete fallback |
| 🔗 | **Backlinks** | Backlink profile, referring domains, anchor text, dofollow/nofollow analysis |
| 📊 | **Rank Tracking** | Historical position snapshots with saved keywords and notes |
| 💡 | **SEO Opportunities** | Striking distance keywords, low CTR, content decay, cannibalization detection |
| 🔔 | **Alerts** | Traffic drops, position changes, new 404s, vitals degradation — via email, Slack, Telegram, webhook |
| 📥 | **CSV Export** | Export keywords and pages data for offline analysis |
| 🌗 | **Dark / Light theme** | Atomize PRO design system with smooth theme toggle |

<!-- TODO: Replace with actual screenshots -->
<details>
<summary>📸 Screenshots</summary>

| Dashboard | Keywords | Crawl / Audit |
|---|---|---|
| <img src="docs/screenshots/dashboard.png" width="280" /> | <img src="docs/screenshots/keywords.png" width="280" /> | <img src="docs/screenshots/crawl.png" width="280" /> |

| Core Web Vitals | Keyword Research | AI & MCP |
|---|---|---|
| <img src="docs/screenshots/vitals.png" width="280" /> | <img src="docs/screenshots/keyword-research.png" width="280" /> | <img src="docs/screenshots/mcp.png" width="280" /> |

</details>

## Quick Start

```bash
git clone https://github.com/crawlseo/crawlseo.git
cd crawlseo
cp .env.example .env.local
# Add your Google OAuth credentials to .env.local
docker compose up -d db
npm install
npx prisma migrate dev --name init
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with Google, and add your first site.

<details>
<summary>🔑 Getting Google OAuth credentials</summary>

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable the **Google Search Console API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
7. Copy Client ID and Client Secret to `.env.local`

Required scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/webmasters.readonly`

</details>

## MCP Server — AI Agent Integration

CrawlSEO includes a Model Context Protocol server so AI agents can query your SEO data directly.

Add to your Claude Code settings (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "crawlseo": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/path/to/crawlseo"
    }
  }
}
```

**10 tools available:**

| Category | Tools |
|---|---|
| **Sites** | `list_sites`, `get_site_overview` |
| **Keywords & Pages** | `get_keywords`, `get_pages`, `get_traffic` |
| **Crawl & Audit** | `run_crawl`, `get_crawl_status`, `get_crawl_issues` |
| **Performance** | `get_vitals`, `get_opportunities` |

Works with Claude Code, Claude Desktop, and Cursor. See [`mcp/README.md`](mcp/README.md) for full setup guide.

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org/) (App Router) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) |
| **Database** | [PostgreSQL](https://www.postgresql.org/) |
| **ORM** | [Prisma](https://www.prisma.io/) |
| **Auth** | [NextAuth.js v5](https://authjs.dev/) |
| **UI** | [shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| **Charts** | [Recharts](https://recharts.org/) |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **MCP** | [@modelcontextprotocol/sdk](https://modelcontextprotocol.io/) |
| **Deployment** | Docker Compose |

## Self-Hosting

### Docker Compose (recommended)

```bash
git clone https://github.com/crawlseo/crawlseo.git
cd crawlseo
cp .env.example .env.local
# Edit .env.local with your credentials
docker compose up --build
```

The full stack (PostgreSQL + Next.js) starts in ~2 minutes. Migrations run automatically.

### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template)

1. Click the button above
2. Add environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`)
3. Railway provisions PostgreSQL automatically

### Manual

```bash
# Prerequisites: Node.js 20+, PostgreSQL

npm install
cp .env.example .env.local
# Configure .env.local

npx prisma migrate deploy
npm run build
npm start
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Session encryption key (`openssl rand -hex 32`) |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `NEXTAUTH_URL` | No | Base URL (auto-detected in most environments) |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Fork the repo, then:
git checkout -b feature/your-feature
# Make your changes
git commit -m "feat: add your feature"
git push origin feature/your-feature
# Open a Pull Request
```

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built by [Brandson Digital](https://brandson.digital) · Created by [Mike](https://m1ke.digital)

Self-hosted SEO tools should be free. Your data should be yours.

</div>
