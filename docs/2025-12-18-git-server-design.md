# Git Server Design for Skills Supply

> Serves git repositories dynamically over HTTPS using `git upload-pack --stateless-rpc`

---

## Overview

This component serves git repositories dynamically over HTTPS, generating content per-user based on their purchases. We use `git upload-pack --stateless-rpc` directly rather than `git-http-backend` (CGI) to avoid parsing CGI response headers.

**Why `git upload-pack --stateless-rpc`?**
- We control HTTP headers directly (no CGI parsing)
- stdout is pure data - just pipe it to response
- Battle-tested (it's git's own protocol implementation)
- Can swap to full `git-http-backend` later if we need push support

**Request Flow:**

```
Client: git clone https://skills.supply/me/marketplace.git
                           │
                           ▼
┌─────────────────────────────────────────────────────┐
│  Hono Server                                         │
│  1. Extract token from Authorization header          │
│  2. Validate token, get user                         │
│  3. Generate/update repo with commit history         │
│  4. Spawn git upload-pack --stateless-rpc           │
│  5. Pipe stdout → response                          │
└─────────────────────────────────────────────────────┘
```

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
      "source": { "source": "url", "url": "https://skills.supply/me/plugins/code-reviewer.git" }
    },
    {
      "name": "tdd-helper",
      "description": "TDD workflow [NOT PURCHASED]",
      "source": { "source": "url", "url": "https://skills.supply/me/plugins/tdd-helper.git" }
    }
  ]
}
```

### 2. Plugin Repos (`/me/plugins/:name.git`)

- **Purchased**: Mirror of creator's private GitHub repo
- **Not purchased**: Stub with `/buy` command

---

## Git Integration

We handle two endpoints and spawn `git upload-pack --stateless-rpc` directly.

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /info/refs?service=git-upload-pack` | List refs (branches, HEAD) |
| `POST /git-upload-pack` | Send pack data |

### Implementation

```typescript
import { spawn } from 'node:child_process';
import { Hono } from 'hono';

const app = new Hono();

// Endpoint 1: Reference discovery
app.get('/me/:repo.git/info/refs', async (c) => {
  if (c.req.query('service') !== 'git-upload-pack') {
    return c.text('Forbidden', 403);
  }

  const user = await authenticate(c);
  if (!user) {
    c.header('WWW-Authenticate', 'Basic realm="Skills Supply"');
    return c.text('Authentication required', 401);
  }

  const repoPath = await getOrCreateRepo(user, c.req.param('repo'));

  c.header('Content-Type', 'application/x-git-upload-pack-advertisement');
  c.header('Cache-Control', 'no-cache');

  // Service announcement (required by protocol)
  const announcement = '001e# service=git-upload-pack\n0000';

  const proc = spawn('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', repoPath]);

  return streamResponse(c, announcement, proc.stdout);
});

// Endpoint 2: Pack transfer
app.post('/me/:repo.git/git-upload-pack', async (c) => {
  const user = await authenticate(c);
  if (!user) {
    c.header('WWW-Authenticate', 'Basic realm="Skills Supply"');
    return c.text('Authentication required', 401);
  }

  const repoPath = await getOrCreateRepo(user, c.req.param('repo'));
  const body = await c.req.arrayBuffer();

  c.header('Content-Type', 'application/x-git-upload-pack-result');
  c.header('Cache-Control', 'no-cache');

  const proc = spawn('git', ['upload-pack', '--stateless-rpc', repoPath]);
  proc.stdin.write(Buffer.from(body));
  proc.stdin.end();

  return stream(c, proc.stdout);
});

export default app;
```

---

## Error Handling

### Authentication Errors

```typescript
if (!user) {
  c.header('WWW-Authenticate', 'Basic realm="Skills Supply"');
  return c.text('Authentication required', 401);
}
```

### Repo Not Found

```typescript
if (!plugin) {
  return c.text('Repository not found', 404);
}
```

### Git Process Failures

```typescript
const proc = spawn('git', ['upload-pack', '--stateless-rpc', repoPath]);

proc.on('error', (err) => {
  console.error('Failed to spawn git:', err);
});

proc.stderr.on('data', (data) => {
  console.error('git stderr:', data.toString());
});

proc.on('close', (code) => {
  if (code !== 0) {
    console.error(`git exited with code ${code}`);
  }
});
```

**Key Principle:** Log everything server-side. Git clients show generic errors anyway.

---

## Caching & Commit History

Generated repos maintain commit history so Claude Code's `git fetch` works efficiently.

### Why Maintain History?

Claude Code updates plugins via:
1. `git fetch` to get new refs
2. Checkout/reset to fetched commit

If we generate unrelated histories each time:
- Fetch succeeds
- Checkout fails (unrelated histories)
- Claude Code deletes cache and re-clones (wasteful)

With maintained history:
- Fetch succeeds
- Fast-forward checkout succeeds
- Efficient incremental updates

### Database Schema

```sql
CREATE TABLE repo_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  repo_name VARCHAR(64) NOT NULL,           -- 'marketplace' or 'plugins/code-reviewer'
  last_commit_sha VARCHAR(40) NOT NULL,
  content_hash VARCHAR(12) NOT NULL,
  repo_path VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, repo_name)
);
```

### Generation Flow

```typescript
async function getOrCreateRepo(user: User, repoName: string): Promise<string> {
  // 1. Generate content
  const files = await generateContent(user, repoName);
  const contentHash = hashContent(files);

  // 2. Check existing state
  const state = await db.repoState.find(user.id, repoName);

  if (state && state.contentHash === contentHash) {
    // Content unchanged - serve existing repo
    return state.repoPath;
  }

  // 3. Content changed - create new commit
  const repoPath = `/tmp/sksup-repos/${user.username}/${repoName}`;

  if (state) {
    // Incremental: add commit on top of existing
    await addCommit(repoPath, files, state.lastCommitSha);
  } else {
    // First time: create repo with initial commit
    await createBareRepo(repoPath);
    await addCommit(repoPath, files, null);
  }

  const newSha = await getHeadSha(repoPath);

  // 4. Update state
  await db.repoState.upsert(user.id, repoName, {
    lastCommitSha: newSha,
    contentHash,
    repoPath,
  });

  return repoPath;
}
```

### Creating Commits Programmatically

```typescript
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

async function addCommit(
  bareRepoPath: string,
  files: Record<string, string>,
  parentSha: string | null
): Promise<void> {
  // Create temp worktree
  const tmpDir = mkdtempSync('/tmp/sksup-worktree-');

  try {
    // Write files
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(tmpDir, filePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
    }

    // Create tree object
    const env = { GIT_DIR: bareRepoPath, GIT_WORK_TREE: tmpDir };
    execSync('git add -A', { cwd: tmpDir, env });
    const treeSha = execSync('git write-tree', { env }).toString().trim();

    // Create commit object
    const parentArg = parentSha ? `-p ${parentSha}` : '';
    const commitSha = execSync(
      `git commit-tree ${treeSha} ${parentArg} -m "Update content"`,
      { env }
    ).toString().trim();

    // Update refs/heads/main
    execSync(`git update-ref refs/heads/main ${commitSha}`, { env });

  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function createBareRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true });
  execSync(`git init --bare ${repoPath}`);
}

async function getHeadSha(repoPath: string): Promise<string> {
  return execSync(`git -C ${repoPath} rev-parse HEAD`).toString().trim();
}
```

### Cache Cleanup

```bash
# Cron job: delete repos older than 24 hours (orphaned entries)
find /tmp/sksup-repos -type d -mindepth 3 -mtime +1 -exec rm -rf {} +
```

---

## File Structure

```
packages/api/
├── src/
│   ├── index.ts              # Hono app entry point
│   ├── routes/
│   │   ├── git.ts            # Git HTTP endpoints (/me/:repo.git/*)
│   │   └── auth.ts           # CLI auth endpoints (/auth/cli/*)
│   ├── services/
│   │   ├── repo-generator.ts # Generate marketplace/plugin content
│   │   ├── git-ops.ts        # Git operations (createBareRepo, addCommit)
│   │   └── auth.ts           # Token validation
│   ├── db/
│   │   └── schema.ts         # Drizzle schema (users, tokens, repo_state)
│   └── utils/
│       └── basic-auth.ts     # Extract credentials from Authorization header
├── package.json
└── tsconfig.json
```

---

## Dependencies

```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "drizzle-orm": "^0.30.0",
    "@neondatabase/serverless": "^0.9.0"
  }
}
```

---

## Environment Requirements

- **Runtime**: Node.js 20+
- **Git**: Must be installed on server (`git upload-pack` command)
- **Database**: PostgreSQL (Neon or GCP)
- **Hosting**: Fly.io (persistent disk for git repos)

---

## Endpoint Summary

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/me/:repo.git/info/refs` | Ref discovery (requires `?service=git-upload-pack`) |
| POST | `/me/:repo.git/git-upload-pack` | Pack data transfer |
| GET | `/auth/cli` | Start CLI auth session |
| GET | `/auth/cli/status` | Poll for auth completion |

---

## Future Enhancements

1. **Push support**: If we need push support, switch to `git-http-backend` (CGI)
2. **Pre-warm cache**: Generate repos on purchase, not first request
3. **CDN for packfiles**: Cache generated packs at edge for faster clones
4. **Webhook notifications**: Notify Claude Code when plugins update

---

## References

- [Git HTTP Protocol Spec](https://git-scm.com/docs/http-protocol)
- [Git Transfer Protocols (Pro Git)](https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols)
- [git-upload-pack manual](https://git-scm.com/docs/git-upload-pack)
