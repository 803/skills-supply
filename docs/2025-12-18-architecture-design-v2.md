# Skills Supply: Architecture Design v2

> Monetization engine for Agent Skills — HTTPS-based approach

## Executive Summary

Skills Supply enables skill creators to monetize their Agent Skills and distribute them to coding agents (Claude Code, Amp, Cursor, etc.). This document describes the architecture using **HTTPS-based git serving** for simplicity, scalability, and ease of deployment.

---

## Problem Statement

**For Creators:**
- Have skills in private GitHub repos
- Want to sell them without building distribution infrastructure
- Need analytics on usage and revenue

**For End Users:**
- Want to discover and buy skills easily
- Need skills to work seamlessly with their coding agent
- Want purchases to sync across devices

**For the Platform:**
- Must integrate with existing agent plugin/marketplace systems
- Must prevent unauthorized access and piracy
- Must be simple to build, deploy, and scale

---

## Core Design Decisions

### 1. User-Specific Marketplaces

Each user gets a personalized marketplace URL:
```
https://skaas.com/u/alice/marketplace.git
```

This single marketplace contains ALL skills from ALL creators:
- **Purchased skills** → Full content served
- **Trial skills** → Full content (time-limited server-side)
- **Unpurchased skills** → Stub with `/buy` command

**Why user-specific?**
- Server controls everything — no client-side hacks needed
- Updates "just work" — server decides entitlements at fetch time
- Enables personalization, recommendations, usage analytics
- Single marketplace to manage, not one per creator

### 2. HTTPS over SSH

We chose HTTPS-based git serving over SSH because:

| Aspect | SSH | HTTPS |
|--------|-----|-------|
| Server complexity | sshd + AuthorizedKeysCommand + scripts | Standard web server |
| Deployment | Requires VM with SSH access | Works anywhere (Railway, Fly, etc.) |
| Scaling | Vertical, sticky sessions | Horizontal, stateless |
| Firewall | Port 22 often blocked | Port 443 always open |
| Auth mechanism | SSH keypairs | Bearer tokens |
| Client setup | Generate keys, register pubkey | Store token in credential helper |

### 3. Token-Based Authentication

Users authenticate via API tokens stored in git's credential helper:
```
https://alice:sk_live_abc123@skaas.com
```

Git automatically sends credentials on every request. Server validates token and serves appropriate content.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              END USER FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  $ npx skaas auth                                                    │    │
│  │                                                                      │    │
│  │  1. Opens browser: https://skaas.com/auth/cli?session=xyz           │    │
│  │  2. User logs in (or signs up)                                      │    │
│  │  3. Browser shows: "CLI authenticated!"                             │    │
│  │  4. CLI polls /auth/cli/status?session=xyz → gets token             │    │
│  │  5. CLI configures git credential helper:                           │    │
│  │     git config --global credential.https://skaas.com.helper store   │    │
│  │  6. CLI stores: https://alice:sk_live_abc@skaas.com in credentials  │    │
│  │  7. CLI outputs:                                                    │    │
│  │     ✓ Authenticated as alice@example.com                            │    │
│  │     Add your marketplace to Claude Code:                            │    │
│  │     /plugin marketplace add https://skaas.com/u/alice/marketplace   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  User in Claude Code:                                                │    │
│  │  /plugin marketplace add https://skaas.com/u/alice/marketplace      │    │
│  │                                                                      │    │
│  │  Claude Code runs: git clone https://skaas.com/u/alice/marketplace  │    │
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
│  2. Connects private GitHub repo containing skill(s)                        │
│  3. Configures: pricing, description, trial options                         │
│  4. System indexes skill metadata                                           │
│  5. Skill appears in all users' marketplaces (as stub until purchased)     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              PURCHASE FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User sees unpurchased skill in their marketplace                        │
│  2. Skill is a "stub" with /buy command                                     │
│  3. User runs /buy in Claude Code                                           │
│  4. Browser opens: https://skaas.com/buy/skill-name?user=alice              │
│  5. User completes payment (Stripe)                                         │
│  6. Server records purchase                                                 │
│  7. Next marketplace fetch → skill serves full content                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Git HTTP Smart Protocol

When Claude Code runs `git clone https://skaas.com/u/alice/marketplace.git`:

### Request 1: Discover refs
```http
GET /u/alice/marketplace.git/info/refs?service=git-upload-pack HTTP/1.1
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
POST /u/alice/marketplace.git/git-upload-pack HTTP/1.1
Host: skaas.com
Authorization: Basic YWxpY2U6c2tfbGl2ZV9hYmMxMjM=
Content-Type: application/x-git-upload-pack-request

0032want abc123...
00000009done
```

Server responds with pack data containing the repository files.

---

## Server Components

### 1. Web Server (Express/Fastify/Hono)

```
/auth/cli                    → CLI authentication flow
/auth/cli/status             → Poll for auth completion
/api/users                   → User management
/api/skills                  → Skill CRUD (for creators)
/api/purchases               → Purchase management

/u/:username/marketplace.git → Git smart HTTP endpoints
/u/:username/skills/:name.git → Individual skill repos
```

### 2. Git HTTP Handler

Handles the git smart protocol:

```typescript
// Pseudocode
app.get('/u/:username/:repo.git/info/refs', async (req, res) => {
  const { username, repo } = req.params;
  const token = extractBasicAuth(req);

  // Validate token
  const user = await validateToken(token);
  if (!user || user.username !== username) {
    return res.status(401).send('Unauthorized');
  }

  // Generate repository content based on user's entitlements
  const repoContent = await generateRepo(user, repo);

  // Return git refs
  const refs = await getGitRefs(repoContent);
  res.setHeader('Content-Type', 'application/x-git-upload-pack-advertisement');
  res.send(formatRefs(refs));
});

app.post('/u/:username/:repo.git/git-upload-pack', async (req, res) => {
  // Similar auth check
  // Parse wants from request
  // Generate and return pack data
});
```

### 3. Repository Generator

Dynamically generates git repositories based on user's purchases:

```typescript
async function generateMarketplace(user: User): Promise<GitRepo> {
  // Get all skills
  const allSkills = await db.skills.findAll();

  // Get user's purchases
  const purchases = await db.purchases.findByUser(user.id);
  const purchasedSkillIds = new Set(purchases.map(p => p.skillId));

  // Build marketplace.json
  const plugins = allSkills.map(skill => ({
    name: skill.name,
    description: purchasedSkillIds.has(skill.id)
      ? skill.description
      : `${skill.description} [NOT PURCHASED - run /buy to unlock]`,
    source: {
      source: 'url',
      url: `https://skaas.com/u/${user.username}/skills/${skill.name}.git`
    },
    version: skill.version
  }));

  const marketplaceJson = {
    name: `${user.username}-marketplace`,
    owner: { name: 'Skills Supply', email: 'support@skaas.com' },
    plugins
  };

  // Create git repo with this content
  return createGitRepo({
    '.claude-plugin/marketplace.json': JSON.stringify(marketplaceJson, null, 2)
  });
}

async function generateSkillRepo(user: User, skillName: string): Promise<GitRepo> {
  const skill = await db.skills.findByName(skillName);
  const purchase = await db.purchases.find(user.id, skill.id);

  if (purchase) {
    // Serve full content from creator's repo
    return await fetchCreatorRepo(skill.sourceRepo);
  } else {
    // Serve stub
    return createStubRepo(skill);
  }
}
```

### 4. Stub Repository

For unpurchased skills:

```
skill-name/
├── SKILL.md
├── plugin.json
└── commands/
    └── buy.md
```

**SKILL.md:**
```markdown
---
name: skill-name
description: AI-powered code review capabilities. [PURCHASE REQUIRED]
---

# Skill Name

This skill provides powerful capabilities for your coding workflow.

## Features
- Feature 1
- Feature 2
- Feature 3

## Get Access

Run the `/buy` command to purchase this skill, or visit:
https://skaas.com/skills/skill-name
```

**commands/buy.md:**
```markdown
---
name: buy
description: Purchase this skill to unlock full functionality
---

Opening browser to complete purchase...

<!-- The actual purchase URL will be opened by the skill system -->
```

---

## Data Model

### Users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### API Tokens
```sql
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,  -- SHA256 of token
  token_prefix VARCHAR(8) NOT NULL,        -- "sk_live_" for display
  name VARCHAR(255),                        -- "MacBook Pro", "Work Desktop"
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
```

### Skills
```sql
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES users(id),
  name VARCHAR(64) UNIQUE NOT NULL,
  description TEXT NOT NULL,
  source_repo VARCHAR(255) NOT NULL,       -- Creator's private GitHub repo
  version VARCHAR(32) NOT NULL,
  pricing_type VARCHAR(20) NOT NULL,       -- 'one-time', 'subscription', 'free'
  price_cents INTEGER,
  currency VARCHAR(3) DEFAULT 'USD',
  trial_days INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Purchases
```sql
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  skill_id UUID REFERENCES skills(id),
  type VARCHAR(20) NOT NULL,               -- 'purchase', 'trial'
  stripe_payment_id VARCHAR(255),
  expires_at TIMESTAMP,                    -- For trials/subscriptions
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);
CREATE INDEX idx_purchases_user ON purchases(user_id);
```

### CLI Auth Sessions
```sql
CREATE TABLE cli_auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token VARCHAR(64) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id),       -- Set after login
  api_token VARCHAR(64),                   -- Generated token to return to CLI
  status VARCHAR(20) DEFAULT 'pending',    -- 'pending', 'completed', 'expired'
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '10 minutes'
);
```

---

## CLI Tool: `npx skaas`

### Commands

```bash
skaas auth      # Authenticate and configure git credentials
skaas status    # Show current auth status and account info
skaas logout    # Remove credentials and deauthorize
skaas whoami    # Show current user
```

### Auth Flow Implementation

```typescript
// skaas auth
async function auth() {
  // 1. Create session
  const sessionToken = crypto.randomBytes(32).toString('hex');

  // 2. Open browser
  const authUrl = `https://skaas.com/auth/cli?session=${sessionToken}`;
  console.log(`Opening browser to authenticate...`);
  await open(authUrl);

  // 3. Poll for completion
  console.log(`Waiting for authentication...`);
  let token: string | null = null;
  while (!token) {
    await sleep(2000);
    const response = await fetch(`https://skaas.com/auth/cli/status?session=${sessionToken}`);
    const data = await response.json();

    if (data.status === 'completed') {
      token = data.token;
    } else if (data.status === 'expired') {
      console.error('Authentication timed out. Please try again.');
      process.exit(1);
    }
  }

  // 4. Configure git credential helper
  const username = data.username;
  execSync(`git config --global credential.https://skaas.com.helper store`);

  // 5. Store credentials
  const credentialsPath = path.join(os.homedir(), '.git-credentials');
  const credLine = `https://${username}:${token}@skaas.com\n`;

  // Append or update existing skaas.com credential
  let creds = fs.existsSync(credentialsPath)
    ? fs.readFileSync(credentialsPath, 'utf8')
    : '';
  creds = creds.split('\n')
    .filter(line => !line.includes('skaas.com'))
    .concat(credLine)
    .join('\n');
  fs.writeFileSync(credentialsPath, creds, { mode: 0o600 });

  // 6. Success message
  console.log(`\n✓ Authenticated as ${data.email}`);
  console.log(`\nAdd your marketplace to Claude Code:`);
  console.log(`  /plugin marketplace add https://skaas.com/u/${username}/marketplace`);
}
```

---

## Security Considerations

### Token Security
- Tokens are hashed (SHA256) before storage
- Tokens can be revoked from web dashboard
- Tokens have optional expiry
- Each device gets its own token (visible in dashboard)

### Content Protection
- Skill content is never served without valid token
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

### Recommended Stack
- **Runtime**: Node.js or Bun
- **Framework**: Hono or Fastify (fast, lightweight)
- **Database**: PostgreSQL (Neon, Supabase, or self-hosted)
- **Hosting**: Railway, Fly.io, or Render
- **Payments**: Stripe

### Environment Variables
```bash
DATABASE_URL=postgresql://...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
JWT_SECRET=...
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=...
```

### Deployment Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                        PRODUCTION                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Railway    │    │   Railway    │    │   Railway    │       │
│  │   Web (x3)   │    │   Web (x3)   │    │   Web (x3)   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                  │                  │                  │
│         └──────────────────┼──────────────────┘                  │
│                            │                                     │
│                     ┌──────▼──────┐                              │
│                     │  PostgreSQL │                              │
│                     │   (Neon)    │                              │
│                     └─────────────┘                              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Redis (optional, for caching generated repos)          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Set up project (Hono + PostgreSQL)
- [ ] Implement user auth (email/password + OAuth)
- [ ] Implement CLI auth flow (`npx skaas auth`)
- [ ] Implement API token management
- [ ] Basic web dashboard

### Phase 2: Git Server (Week 2-3)
- [ ] Implement git HTTP smart protocol
- [ ] Dynamic marketplace generation
- [ ] Dynamic skill repo generation (stub vs full)
- [ ] Caching layer for generated repos

### Phase 3: Creator Flow (Week 3-4)
- [ ] GitHub App for repo access
- [ ] Skill registration from GitHub repo
- [ ] Skill metadata extraction
- [ ] Creator dashboard

### Phase 4: Payments (Week 4-5)
- [ ] Stripe integration
- [ ] Purchase flow
- [ ] Creator payouts (Stripe Connect)
- [ ] Purchase history

### Phase 5: Polish (Week 5-6)
- [ ] Skill discovery/browse page
- [ ] Usage analytics
- [ ] Rate limiting
- [ ] Error handling and monitoring

---

## Open Questions

1. **Caching strategy** — How long to cache generated repos? Invalidation on purchase?
2. **Multi-agent support** — Different formats for Amp, Cursor? Transform on-the-fly?
3. **Skill updates** — How to notify users of updates? Webhook to Claude Code?
4. **Refund policy** — Time-limited refunds? Automatic or manual?
5. **Platform fee** — What percentage does skaas take? (Industry standard: 15-30%)
6. **Free tier** — Free skills allowed? Freemium model for creators?

---

## Appendix: Why Not SSH?

We considered SSH-based git serving (like GitHub) but chose HTTPS because:

1. **Deployment complexity**: SSH requires sshd configuration, port 22 access, and careful security setup. HTTPS works with standard web hosting.

2. **Scaling**: SSH connections are stateful and harder to load-balance. HTTPS is stateless and scales horizontally.

3. **Firewall friendliness**: Many corporate networks block port 22. Port 443 is always open.

4. **Tooling**: Standard HTTP monitoring, logging, and debugging tools work out of the box.

5. **Speed to market**: We can ship faster with HTTPS and a standard web framework.

The tradeoff is that SSH keys feel more "developer-friendly" and secure, but token-based auth is equally secure when implemented correctly (HTTPS, hashed tokens, revocation capability).
