# Skills Supply: Architecture Design v3

> Monetization engine for Agent Plugins — HTTPS-based distribution

---

## Executive Summary

Skills Supply enables creators to monetize their Claude Code plugins and distribute them to coding agents. This document describes the architecture using **HTTPS-based git serving** for simplicity, scalability, and ease of deployment.

**What we sell:** Plugins (the Claude Code term). "Skills Supply" is the platform brand name.

---

## Problem Statement

**For Creators:**
- Have plugins in private GitHub repos
- Want to sell them without building distribution infrastructure
- Need analytics on usage and revenue

**For End Users:**
- Want to discover and buy plugins easily
- Need plugins to work seamlessly with their coding agent
- Want purchases to sync across devices

**For the Platform:**
- Must integrate with existing agent plugin/marketplace systems
- Must prevent unauthorized access and piracy
- Must be simple to build, deploy, and scale

---

## Definitions

**Creator's Source**: A full Claude Code plugin in the creator's private GitHub repo.
- Contains: `plugin.json`, `skills/`, `commands/`, `hooks/`, `agents/`, etc.

**Served Plugin**: What the end-user receives from Skills Supply.
- **Purchased**: Creator's plugin as-is (or with minimal injection)
- **Unpurchased**: Stub plugin with `/buy` command and preview content

**Stub Plugin**: A minimal plugin served for unpurchased items:
- `plugin.json` (basic manifest)
- `SKILL.md` or similar (preview/description)
- `commands/buy.md` (purchase command)

**Unit of Sale**: A plugin (not individual skills).

**Future**: Creators may upload individual skills; we wrap them into plugins.

---

## Core Design Decisions

### 1. User-Specific Marketplaces

Each user gets a personalized marketplace URL:
```
https://skaas.com/me/marketplace.git
```

The token identifies the user — no username needed in the URL. This single marketplace contains ALL plugins from ALL creators:
- **Purchased plugins** → Full content served
- **Unpurchased plugins** → Stub with `/buy` command

**Why `/me/`?**
- Token already identifies the user — username in URL is redundant
- Semantic and self-explanatory
- Provides optionality (e.g., future `/enterprise/:org/marketplace.git`)
- Simpler onboarding: everyone uses the same URL pattern
- No potential for token/path mismatch errors

**Why user-specific?**
- Server controls everything — no client-side hacks needed
- Updates "just work" — server decides entitlements at fetch time
- Enables personalization, recommendations, usage analytics
- Single marketplace to manage, not one per creator

### 2. HTTPS over SSH

We chose HTTPS-based git serving over SSH. See **Appendix: Why Not SSH?** for detailed rationale.

| Aspect | HTTPS |
|--------|-------|
| Server complexity | Standard web server |
| Deployment | Works anywhere (Fly.io, etc.) |
| Scaling | Horizontal, stateless |
| Firewall | Port 443 always open |
| Auth mechanism | Bearer tokens |
| Client setup | Store token in credential helper |

### 3. Token-Based Authentication

Users authenticate via API tokens stored in git's credential helper:
```
https://alice:sk_live_abc123@skaas.com
```

Git automatically sends credentials on every request. Server validates token and serves appropriate content.

**Credential Storage**: We use OS-native credential helpers per platform:

| Platform | Helper | Storage |
|----------|--------|---------|
| macOS | `osxkeychain` | Keychain Access |
| Windows | `manager-core` | Windows Credential Manager |
| Linux | `store` | `~/.git-credentials` (fallback) |

This is more secure than plaintext storage and meets user expectations.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              END USER FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  $ skaas auth                                                        │    │
│  │                                                                      │    │
│  │  1. Opens browser: https://skaas.com/auth/cli?session=xyz           │    │
│  │  2. User logs in (or signs up)                                      │    │
│  │  3. Browser shows: "CLI authenticated!"                             │    │
│  │  4. CLI polls /auth/cli/status?session=xyz → gets token             │    │
│  │  5. CLI configures OS-native credential helper                      │    │
│  │  6. CLI stores token in system keychain                             │    │
│  │  7. CLI outputs:                                                    │    │
│  │     ✓ Authenticated as alice@example.com                            │    │
│  │     Add your marketplace to Claude Code:                            │    │
│  │     /plugin marketplace add https://skaas.com/me/marketplace        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  User in Claude Code:                                                │    │
│  │  /plugin marketplace add https://skaas.com/me/marketplace           │    │
│  │                                                                      │    │
│  │  Claude Code runs: git clone https://skaas.com/me/marketplace.git   │    │
│  │  Git credential helper provides: alice:sk_live_abc                  │    │
│  │  Server authenticates, returns personalized marketplace.json        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              CREATOR FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Creator signs up on skaas.com                                           │
│  2. Connects private GitHub repo containing plugin                          │
│  3. Configures: pricing, description                                        │
│  4. Completes Stripe Connect onboarding (KYC, bank verification)           │
│  5. System indexes plugin metadata                                          │
│  6. Plugin appears in all users' marketplaces (as stub until purchased)    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              PURCHASE FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User sees unpurchased plugin in their marketplace                       │
│  2. Plugin is a "stub" with /buy command                                    │
│  3. User runs /buy in Claude Code                                           │
│  4. Browser opens: https://skaas.com/buy/plugin-name?user=alice             │
│  5. User completes payment (Stripe)                                         │
│  6. Server records purchase, splits payment to creator                      │
│  7. Next marketplace fetch → plugin serves full content                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Git HTTP Smart Protocol

When Claude Code runs `git clone https://skaas.com/me/marketplace.git`:

### Request 1: Discover refs
```http
GET /me/marketplace.git/info/refs?service=git-upload-pack HTTP/1.1
Host: skaas.com
Authorization: Basic YWxpY2U6c2tfbGl2ZV9hYmMxMjM=
```

Server response:
```http
HTTP/1.1 200 OK
Content-Type: application/x-git-upload-pack-advertisement

001e# service=git-upload-pack
0000
00a8abc123... HEAD\0multi_ack thin-pack side-band-64k ofs-delta
003fabc123... refs/heads/main
0000
```

### Request 2: Fetch pack data
```http
POST /me/marketplace.git/git-upload-pack HTTP/1.1
Host: skaas.com
Authorization: Basic YWxpY2U6c2tfbGl2ZV9hYmMxMjM=
Content-Type: application/x-git-upload-pack-request

0032want abc123...
00000009done
```

Server responds with pack data containing the repository files.

**Implementation**: We use `git upload-pack --stateless-rpc` directly rather than `git-http-backend` (CGI). See **Appendix: Why Not git-http-backend?** for rationale.

---

## Repository Types

### 1. Marketplace Repo (`/me/marketplace.git`)

Contains a single file listing all available plugins:

```
.claude-plugin/
└── marketplace.json
```

```json
{
  "name": "user-marketplace",
  "plugins": [
    {
      "name": "code-reviewer",
      "description": "AI code review",
      "source": { "source": "url", "url": "https://skaas.com/me/plugins/code-reviewer.git" }
    },
    {
      "name": "tdd-helper",
      "description": "TDD workflow [NOT PURCHASED]",
      "source": { "source": "url", "url": "https://skaas.com/me/plugins/tdd-helper.git" }
    }
  ]
}
```

### 2. Plugin Repos (`/me/plugins/:name.git`)

- **Purchased**: Mirror of creator's private GitHub repo
- **Not purchased**: Stub plugin with `/buy` command

### 3. Stub Plugin Structure

For unpurchased plugins:

```
plugin-name/
├── plugin.json
├── SKILL.md
└── commands/
    └── buy.md
```

**SKILL.md:**
```markdown
---
name: plugin-name
description: AI-powered code review capabilities. [PURCHASE REQUIRED]
---

# Plugin Name

This plugin provides powerful capabilities for your coding workflow.

## Features
- Feature 1
- Feature 2
- Feature 3

## Get Access

Run the `/buy` command to purchase this plugin, or visit:
https://skaas.com/plugins/plugin-name
```

**commands/buy.md:**
```markdown
---
name: buy
description: Purchase this plugin to unlock full functionality
---

Opening browser to complete purchase...

<!-- The actual purchase URL will be opened by the plugin system -->
```

---

## CLI Tool: `skaas`

The CLI authenticates users and configures git credentials.

### Commands

| Command | Purpose |
|---------|---------|
| `skaas auth` | Authenticate and configure git credentials |
| `skaas status` | Show current auth status and account info |
| `skaas logout` | Remove credentials and deauthorize |
| `skaas whoami` | Show current user |

### Auth Flow (Conceptual)

1. CLI opens browser to `https://skaas.com/auth/cli?session=xyz`
2. User logs in or signs up
3. CLI polls `/auth/cli/status?session=xyz` for completion
4. On success, CLI receives API token
5. CLI configures OS-native credential helper for `skaas.com`
6. CLI stores credentials in system keychain
7. Future git operations automatically authenticate

**Why browser-based auth?**
- No password handling in CLI
- Supports OAuth providers
- User logs into familiar web interface
- Token issuance controlled server-side

### Distribution

| Aspect | Decision |
|--------|----------|
| Written in | TypeScript (monorepo with rest of codebase) |
| Built with | Bun (`bun build --compile` → standalone binary) |
| Binary hosting | GitHub Releases |
| Install: macOS | Homebrew (homebrew-core preferred) |
| Install: Linux/Windows | curl script (`curl -fsSL https://skaas.com/install.sh \| sh`) |

**Platform targets:**
- darwin-arm64 (macOS Apple Silicon)
- darwin-x64 (macOS Intel)
- linux-x64
- windows-x64

**Why Bun compile?**
- Produces standalone binary — no runtime needed on user machine
- Same language as rest of codebase
- Fast startup, small binary

**Flow:**
```
TS source → Bun compile → Binaries per platform → GitHub Release
                                                      ↓
                                          ┌───────────┴───────────┐
                                          ▼                       ▼
                                    homebrew-core            install.sh
```

---

## Security Considerations

### Token Security
- Tokens are hashed (SHA256) before storage
- Tokens can be revoked from web dashboard
- Tokens have optional expiry
- Each device gets its own token (visible in dashboard)
- Tokens stored in OS keychain, not plaintext

### Content Protection
- Plugin content is never served without valid token
- Tokens are tied to specific users
- Server controls all entitlement checks
- No client-side enforcement to bypass

### Rate Limiting
- Git operations rate-limited per token
- Protects against scraping attempts

### HTTPS Only
- All traffic encrypted
- No sensitive data in URLs (token in Authorization header)

---

## Deployment

### Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Runtime | Node.js | |
| API + Git Server | Hono on Fly.io | Persistent disk for git repos |
| Website | Next.js | |
| Database | PostgreSQL | Neon or GCP |
| Secrets | Doppler | |
| Payments | Stripe Connect | |

**Structure**: Monorepo containing:
- API package (Hono)
- Website package (Next.js)
- CLI package (Bun-compiled)

**Requirements:**
- Git must be installed on server (for `git upload-pack`)
- Persistent disk for generated git repositories

### Why Fly.io for API?

Fly.io provides persistent volumes, which we need for storing generated git repositories on disk. Serverless platforms can't maintain this state between requests.

---

## Payments: Stripe Connect

### Model
- **v1**: One-time purchases
- **Future**: Subscriptions

### Why Stripe Connect?

Only platform that supports multi-vendor marketplace model:

| Platform | Problem |
|----------|---------|
| Polar.sh | Single merchant only, no creator payouts |
| Lemon Squeezy | Single merchant only, hidden fees (10-18%) |
| Gumroad | Single merchant only, 10% fees |
| **Stripe Connect** | Multi-vendor, automatic splits, scales |

### Implementation

**Account Type**: Express Accounts
- Stripe handles KYC, bank verification, tax forms (1099s)
- Minimal integration burden
- Creator onboarding via Stripe Account Links

**Revenue Split**: Automatic per-transaction via destination charges

**Example ($100 plugin):**
- Card processing: 2.9% + $0.30 = $3.20
- Platform fee (e.g., 20%): $20.00
- Creator receives: $76.80
- Platform nets: $16.80

### Integration Scope
- Creator onboarding flow (Stripe Account Links)
- Split payment logic (destination charges)
- Webhook handlers for payment/account events
- Creator dashboard for payout history

---

## Open Questions

1. **Caching strategy** — How long to cache generated repos? Invalidation on purchase?
2. **Multi-agent support** — Different formats for Amp, Cursor? Transform on-the-fly?
3. **Plugin updates** — How to notify users of updates? Webhook to Claude Code?
4. **Refund policy** — Time-limited refunds? Automatic or manual?
5. **Platform fee** — What percentage does skaas take? (Industry standard: 15-30%)
6. **Free tier** — Free plugins allowed? Freemium model for creators?

---

## Appendix: Why Not SSH?

We considered SSH-based git serving (like GitHub) but chose HTTPS because:

1. **Deployment complexity**: SSH requires sshd configuration, port 22 access, and careful security setup. HTTPS works with standard web hosting.

2. **Scaling**: SSH connections are stateful and harder to load-balance. HTTPS is stateless and scales horizontally.

3. **Firewall friendliness**: Many corporate networks block port 22. Port 443 is always open.

4. **Tooling**: Standard HTTP monitoring, logging, and debugging tools work out of the box.

5. **Speed to market**: We can ship faster with HTTPS and a standard web framework.

The tradeoff is that SSH keys feel more "developer-friendly" and secure, but token-based auth is equally secure when implemented correctly (HTTPS, hashed tokens, revocation capability).

---

## Appendix: Why Not git-http-backend?

We use `git upload-pack --stateless-rpc` directly instead of the CGI-based `git-http-backend` because:

1. **Simpler response handling**: CGI returns headers + body mixed in stdout. We'd need to parse the CGI response format to extract HTTP headers.

2. **Pure data stream**: `git upload-pack --stateless-rpc` gives pure pack data — just pipe it directly to the HTTP response body.

3. **Same result**: Both use the same underlying git protocol. We just skip the CGI wrapper.

4. **Upgrade path**: Can switch to full `git-http-backend` later if we need push support.

---

## Related Documents

- **Git Server Design** (`2025-12-18-git-server-design.md`): Detailed implementation of the git HTTP handler, caching strategy, and commit history management.
- **CLI Design** (`2025-12-19-cli-design.md`): Full implementation details, credential helper logic, polling, error handling, distribution.
