# Skills Supply: Architecture Design

> Monetization engine for Agent Skills

## Overview

Skills Supply (working name: "skaas") is a platform that enables skill creators to monetize their Agent Skills and distribute them to coding agents like Claude Code, Amp, Cursor, and others.

## Problem Statement

Skills are becoming popular in the AI coding assistant ecosystem. Creators want to:
- Sell skills they've made
- Distribute to multiple agent platforms
- Track usage and manage licenses

End users want to:
- Discover and buy skills easily
- Keep skills updated across devices
- Have a unified marketplace experience

## Core Architecture

### The User-Specific Marketplace Model

Each end user gets a personalized marketplace URL:

```
git@skaas.com:u/alice/marketplace.git
```

This marketplace contains ALL skills from ALL creators, with content served based on the user's entitlements:

| Skill State | What Server Serves |
|-------------|-------------------|
| Purchased | Full skill content |
| Free Trial | Full content (time-limited server-side) |
| Not Purchased | Stub with `/buy` command |

### Why User-Specific Marketplaces?

- **Server controls everything** - No client-side hacks needed
- **Updates just work** - Server decides entitlements at fetch time
- **Discovery built-in** - All skills visible, unpurchased as stubs
- **Personalization** - Recommendations, usage analytics, trial management
- **Multi-device** - Same account, same entitlements everywhere

## Authentication: SSH Key Model

We use SSH key-based authentication, identical to GitHub's model.

### Device Registration Flow

```
$ npx skaas auth

1. CLI generates SSH key pair
   → ~/.ssh/skaas (private key - never leaves device)
   → ~/.ssh/skaas.pub (public key)

2. CLI opens browser with public key in URL:
   https://skaas.com/auth/device?pubkey=ssh-ed25519+AAAA...+device-name

3. User logs in (or signs up) on that page
   → Server associates pubkey with their account
   → Page shows: "Device registered! ✓"

4. CLI polls /auth/status?pubkey=... until confirmed

5. CLI configures ~/.ssh/config:
   Host skaas.com
     HostName skaas.com
     User git
     IdentityFile ~/.ssh/skaas

6. CLI outputs:
   ✓ Device registered
   ✓ SSH key configured
   Add your marketplace:
   /plugin marketplace add git@skaas.com:u/alice/marketplace.git
```

### Why SSH Keys?

- **Device-bound by nature** - Private key never leaves machine
- **No credential prompts** - Claude Code disables `GIT_TERMINAL_PROMPT`
- **Cross-platform** - Works on macOS, Linux, Windows
- **Familiar model** - Developers already understand this from GitHub
- **Revocable** - Users can manage devices from web dashboard
- **Multi-device** - Each device = separate key, visible in dashboard

### Security Properties

- Sharing the marketplace URL alone is useless (requires private key)
- Each device has unique key pair
- Server can revoke individual device access
- No secrets in URLs or configs

## Purchase Flow

### Creator Side

1. Creator has private GitHub repo with skill(s)
2. Connects repo to skaas.com dashboard
3. Configures: pricing, description, trial options
4. System automatically:
   - Indexes skill metadata
   - Makes skill available in all user marketplaces (as stubs)
   - Handles packaging for different agent platforms

### End User Side

1. User has skaas marketplace installed in Claude Code
2. Browses available skills (all visible, unpurchased as stubs)
3. Tries to use unpurchased skill → gets stub with `/buy` command
4. Runs `/buy` → opens browser to skaas.com payment page
5. Completes payment
6. Next marketplace update → skill now serves full content

### Buy Command Flow

```
User runs: /buy super-formatter

1. Command opens browser:
   https://skaas.com/buy/super-formatter?user=alice

2. User completes payment on web

3. Server updates alice's entitlements

4. User runs: /plugin marketplace update
   (or waits for auto-update)

5. Skill now works - full content served
```

## System Components

### 1. Git Server

Serves user-specific marketplace repositories via SSH.

```
Incoming: git clone git@skaas.com:u/alice/marketplace.git

Server:
1. Authenticates via SSH public key
2. Looks up user from pubkey
3. Generates marketplace.json with all skills:
   - Purchased skills → full content sources
   - Unpurchased skills → stub sources
4. Returns as valid git repository
```

**Implementation options:**
- Custom git server (gitolite, gitea, custom)
- Dynamic repo generation per-request
- Caching layer for performance

### 2. Skill Proxy

Serves individual skill repositories based on entitlements.

```
Incoming: git clone git@skaas.com:u/alice/skills/super-formatter.git

Server:
1. Authenticates via SSH public key
2. Checks: Does alice own super-formatter?
3. If yes → proxy to creator's private repo (full content)
4. If no → serve stub repository with /buy command
```

### 3. Web Dashboard

**For Creators:**
- Connect GitHub repos
- Set pricing and trial options
- View analytics (installs, usage, revenue)
- Manage skill metadata

**For End Users:**
- Manage devices (view/revoke SSH keys)
- View purchase history
- Browse and buy skills
- Manage trials

### 4. CLI Tool (`npx skaas`)

Commands:
- `skaas auth` - Register device, configure SSH
- `skaas status` - Show account info, devices
- `skaas logout` - Remove device registration

### 5. Agent Adapters

Transform skills for different agent platforms:

| Platform | Skill Format | Marketplace Format |
|----------|--------------|-------------------|
| Claude Code | SKILL.md + plugin.json | marketplace.json |
| Amp | TBD | TBD |
| Cursor | TBD | TBD |
| Codex | TBD | TBD |

## Data Model

### User

```typescript
interface User {
  id: string
  email: string
  name: string
  devices: Device[]
  purchases: Purchase[]
  createdAt: Date
}
```

### Device

```typescript
interface Device {
  id: string
  userId: string
  name: string // "MacBook Pro", "Work Desktop"
  publicKey: string // SSH public key
  lastUsedAt: Date
  createdAt: Date
}
```

### Skill

```typescript
interface Skill {
  id: string
  creatorId: string
  name: string
  description: string
  sourceRepo: string // Creator's private GitHub repo
  pricing: {
    type: 'one-time' | 'subscription' | 'free'
    amount?: number
    currency?: string
    trialDays?: number
  }
  platforms: string[] // ['claude-code', 'amp', ...]
  createdAt: Date
}
```

### Purchase

```typescript
interface Purchase {
  id: string
  userId: string
  skillId: string
  type: 'purchase' | 'trial'
  expiresAt?: Date // For trials or subscriptions
  createdAt: Date
}
```

## Marketplace.json Generation

For user `alice` who purchased `super-formatter` but not `code-reviewer`:

```json
{
  "name": "alice-marketplace",
  "owner": {
    "name": "Skills Supply",
    "email": "support@skaas.com"
  },
  "plugins": [
    {
      "name": "super-formatter",
      "source": {
        "source": "url",
        "url": "git@skaas.com:u/alice/skills/super-formatter.git"
      },
      "description": "Auto-format code on save",
      "version": "2.1.0"
    },
    {
      "name": "code-reviewer",
      "source": {
        "source": "url",
        "url": "git@skaas.com:u/alice/skills/code-reviewer.git"
      },
      "description": "AI-powered code review [NOT PURCHASED - run /buy to unlock]",
      "version": "1.0.0"
    }
  ]
}
```

When Claude Code fetches `super-formatter.git` → full content.
When Claude Code fetches `code-reviewer.git` → stub with /buy command.

## Stub Skill Structure

Unpurchased skills serve a stub that guides users to purchase:

```
code-reviewer/
├── SKILL.md
└── commands/
    └── buy.md
```

**SKILL.md:**
```yaml
---
name: code-reviewer
description: AI-powered code review. [TRIAL/PURCHASE REQUIRED]
---

# Code Reviewer

This skill provides AI-powered code review capabilities.

## Features
- Automated bug detection
- Style consistency checking
- Security vulnerability scanning

## Get Access

Run the `/buy` command to purchase this skill:

/buy code-reviewer

Or start a free trial at: https://skaas.com/skills/code-reviewer
```

**commands/buy.md:**
```yaml
---
name: buy
description: Purchase this skill
---

Opening browser to complete purchase...

[Opens: https://skaas.com/buy/code-reviewer?user=$USER_ID]
```

## Technical Constraints Discovered

### Claude Code Git Behavior

From investigation of Claude Code v2.0.72:

1. **Uses system git** (`/opt/homebrew/bin/git`)
2. **Disables interactive prompts:**
   ```javascript
   GIT_TERMINAL_PROMPT: "0"
   GIT_ASKPASS: ""
   ```
3. **SSH auth works** - Uses `~/.ssh/config` and standard SSH agent
4. **HTTPS credential prompts won't work** - Must use SSH or pre-configured credentials

This is why we chose SSH key authentication.

### Marketplace Storage

Claude Code stores marketplaces at:
```
~/.claude/plugins/marketplaces/<name>/.claude-plugin/marketplace.json
```

Plugins cached at:
```
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
```

## Future Considerations

### Revenue Model (v1)

- Per-skill one-time purchase
- Platform takes percentage cut (e.g., 30%)
- Stripe for payment processing

### Future Revenue Models

- Subscription tiers
- Usage-based pricing
- Bundle deals
- Team/enterprise licenses

### Future Features

- Skill ratings and reviews
- Creator verification
- Skill versioning and changelogs
- Usage analytics for creators
- Team management
- Private marketplaces for enterprises

## Open Questions

1. **Skill updates** - How do we notify users of updates? Auto-update or manual?
2. **Refunds** - Policy for refunds? Time-limited?
3. **Piracy** - If someone extracts skill content, can they redistribute?
4. **Platform fees** - What cut does skaas take?
5. **Creator payouts** - Stripe Connect? Manual payouts?

## Next Steps

1. [ ] Design database schema
2. [ ] Build SSH git server prototype
3. [ ] Build CLI tool (`npx skaas auth`)
4. [ ] Build web dashboard (creator + user)
5. [ ] Integrate Stripe for payments
6. [ ] Build skill proxy (stub vs full content)
7. [ ] Test with Claude Code end-to-end
