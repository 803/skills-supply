# Git Server Implementation Research

## The Problem

We need to serve git repositories dynamically over HTTP(S) where:
1. Content is generated on-the-fly based on user's purchases
2. Authentication happens via HTTP Basic Auth (token in password field)
3. The same URL serves different content for different users

## Git Smart HTTP Protocol Overview

When a client runs `git clone https://skaas.com/u/alice/marketplace.git`:

### Step 1: Reference Discovery
```http
GET /u/alice/marketplace.git/info/refs?service=git-upload-pack HTTP/1.1
Authorization: Basic YWxpY2U6c2tfbGl2ZV9hYmMxMjM=
```

Server responds with refs in pkt-line format:
```
001e# service=git-upload-pack
0000
00a8abc123... HEAD\0multi_ack thin-pack side-band-64k ofs-delta agent=git/2.0
003fabc123... refs/heads/main
0000
```

### Step 2: Pack Negotiation & Download
```http
POST /u/alice/marketplace.git/git-upload-pack HTTP/1.1
Content-Type: application/x-git-upload-pack-request

0032want abc123...
0009done
0000
```

Server responds with packfile containing the repository data.

## Implementation Approaches

### Approach 1: Proxy to `git-http-backend` (CGI)

Git ships with `git-http-backend`, a CGI program that handles the smart protocol.

**How it works:**
1. Generate repo on disk (e.g., `/tmp/repos/alice/marketplace.git`)
2. Set `GIT_PROJECT_ROOT` environment variable
3. Proxy HTTP requests to `git-http-backend`

**Example with Express:**
```javascript
const { spawn } = require('child_process');
const express = require('express');

app.all('/u/:user/:repo.git/*', async (req, res) => {
  const { user, repo } = req.params;

  // Auth check
  const token = extractBasicAuth(req);
  const authUser = await validateToken(token);
  if (!authUser || authUser.username !== user) {
    return res.status(401).send('Unauthorized');
  }

  // Generate repo to temp directory
  const repoPath = await generateRepo(authUser, repo);

  // Spawn git-http-backend
  const cgi = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: '/tmp/repos',
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: `/${user}/${repo}.git${req.params[0]}`,
      QUERY_STRING: req.query.service ? `service=${req.query.service}` : '',
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers['content-type'] || '',
    }
  });

  req.pipe(cgi.stdin);
  cgi.stdout.pipe(res);
});
```

**Pros:**
- Battle-tested (it's what Git itself uses)
- Handles all protocol details correctly
- Supports push (if needed later)

**Cons:**
- Requires git to be installed on server
- Need to generate repos on disk (can cache)
- CGI overhead

---

### Approach 2: Use `git upload-pack --stateless-rpc`

For HTTP, git has a `--stateless-rpc` mode designed for this:

```javascript
// For info/refs
app.get('/u/:user/:repo.git/info/refs', async (req, res) => {
  if (req.query.service !== 'git-upload-pack') {
    return res.status(403).send('Forbidden');
  }

  const repoPath = await generateRepo(user, repo);

  res.setHeader('Content-Type', 'application/x-git-upload-pack-advertisement');
  res.write('001e# service=git-upload-pack\n0000');

  const proc = spawn('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', repoPath]);
  proc.stdout.pipe(res);
});

// For pack data
app.post('/u/:user/:repo.git/git-upload-pack', async (req, res) => {
  const repoPath = await generateRepo(user, repo);

  res.setHeader('Content-Type', 'application/x-git-upload-pack-result');

  const proc = spawn('git', ['upload-pack', '--stateless-rpc', repoPath]);
  req.pipe(proc.stdin);
  proc.stdout.pipe(res);
});
```

**Pros:**
- Simpler than CGI approach
- Still uses git's protocol implementation

**Cons:**
- Still requires git binary
- Still need to generate repos on disk

---

### Approach 3: Pure Go Implementation (go-git)

go-git can create and serve repositories in memory.

```go
package main

import (
    "github.com/go-git/go-git/v5"
    "github.com/go-git/go-git/v5/plumbing/transport/server"
    "github.com/go-git/go-git/v5/storage/memory"
)

func handler(w http.ResponseWriter, r *http.Request) {
    // Create in-memory repo
    storage := memory.NewStorage()
    repo, _ := git.Init(storage, nil)

    // Add files programmatically
    worktree, _ := repo.Worktree()
    // ... add files ...

    // Serve using go-git's server package
    // Note: go-git's HTTP server support is limited
}
```

**Pros:**
- No external git binary needed
- Can work entirely in memory
- Single binary deployment

**Cons:**
- go-git's HTTP server support is incomplete
- Would need to implement protocol handling ourselves
- Less battle-tested than git itself

---

### Approach 4: Pure Python Implementation (dulwich)

Dulwich is a pure Python git implementation with server capabilities.

```python
from dulwich.server import DictBackend, TCPGitServer
from dulwich.repo import MemoryRepo
from dulwich.objects import Blob, Tree, Commit

def create_repo_for_user(user):
    repo = MemoryRepo()

    # Create blob
    blob = Blob.from_string(b'{"name": "marketplace"}')
    repo.object_store.add_object(blob)

    # Create tree
    tree = Tree()
    tree.add(b'marketplace.json', 0o100644, blob.id)
    repo.object_store.add_object(tree)

    # Create commit
    commit = Commit()
    commit.tree = tree.id
    # ... set author, committer, message ...
    repo.object_store.add_object(commit)

    repo.refs[b'refs/heads/main'] = commit.id
    return repo

# dulwich has dulwich.web for WSGI-based HTTP serving
from dulwich.web import make_wsgi_chain
```

**Pros:**
- Pure Python, no external dependencies
- Good HTTP support via `dulwich.web`
- In-memory repos possible

**Cons:**
- Python (if your stack is Node.js)
- Slower than native git

---

### Approach 5: Hybrid - Generate Static Repos + Cache

Instead of generating repos on every request:

1. **On purchase/update**: Generate actual git repo to disk/S3
2. **On request**: Serve from cache, regenerate if stale
3. **Use git-http-backend** or static file serving for actual protocol

```
User purchases skill
        │
        ▼
┌───────────────────────┐
│  Generate git repo    │
│  with user's content  │
│  Store in S3/disk     │
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│  Cache metadata:      │
│  user -> repo_path    │
│  last_updated         │
└───────────────────────┘
        │
        ▼
On clone request:
        │
        ▼
┌───────────────────────┐
│  Check cache          │
│  If stale: regenerate │
│  Serve via git-http   │
└───────────────────────┘
```

**Pros:**
- Best of both worlds
- Can use CDN for packfiles
- Handles scale well

**Cons:**
- More complex architecture
- Cache invalidation challenges

---

## Comparison: HTTPS vs SSH

| Aspect | HTTPS (git-http-backend) | SSH (forced commands) |
|--------|--------------------------|----------------------|
| **Setup complexity** | Moderate | Complex |
| **Auth mechanism** | HTTP Basic (token) | SSH public keys |
| **User setup** | Store token in git credentials | Generate SSH key, register pubkey |
| **Deployment** | Standard web hosting | Requires sshd access |
| **Scaling** | Horizontal, stateless | Vertical, stateful connections |
| **Protocol handling** | git-http-backend or custom | git-upload-pack via forced cmd |
| **Firewall friendly** | Port 443 always open | Port 22 often blocked |

## Recommendation

**For v1, use Approach 2 (git upload-pack --stateless-rpc) with caching:**

1. **Auth**: HTTP Basic Auth, validate token from header
2. **Repo generation**: Generate to temp directory, cache by user+content hash
3. **Serving**: Use `git upload-pack --stateless-rpc` for protocol handling
4. **Cleanup**: TTL-based cache eviction

**Why:**
- Uses git's own protocol implementation (battle-tested)
- Simple to implement with Express/Hono
- Can add caching layer incrementally
- Works on any platform where git is installed
- No need to implement pkt-line protocol ourselves

**Example Implementation:**

```javascript
import { spawn } from 'child_process';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const app = new Hono();
const REPO_CACHE = '/tmp/skaas-repos';

// Generate repo content based on user's purchases
async function generateMarketplace(user) {
  const purchases = await db.getPurchases(user.id);
  const allSkills = await db.getAllSkills();

  const plugins = allSkills.map(skill => ({
    name: skill.name,
    description: purchases.has(skill.id)
      ? skill.description
      : `${skill.description} [NOT PURCHASED]`,
    source: { source: 'url', url: `https://skaas.com/u/${user.username}/skills/${skill.name}.git` }
  }));

  return {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: `${user.username}-marketplace`,
      plugins
    }, null, 2)
  };
}

// Create git repo from file map
async function createGitRepo(files, repoPath) {
  await fs.mkdir(repoPath, { recursive: true });
  await spawn('git', ['init', '--bare', repoPath]);

  // Use git commands to create objects
  // ... (implementation details)
}

// Get or create cached repo
async function getRepo(user, repoName) {
  const content = await generateMarketplace(user);
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 12);

  const repoPath = path.join(REPO_CACHE, user.username, repoName, hash);

  if (!await fs.access(repoPath).then(() => true).catch(() => false)) {
    await createGitRepo(content, repoPath);
  }

  return repoPath;
}

// Info/refs endpoint
app.get('/u/:user/:repo.git/info/refs', async (c) => {
  const service = c.req.query('service');
  if (service !== 'git-upload-pack') {
    return c.text('Forbidden', 403);
  }

  const user = await authenticateRequest(c);
  if (!user) return c.text('Unauthorized', 401);

  const repoPath = await getRepo(user, c.req.param('repo'));

  c.header('Content-Type', 'application/x-git-upload-pack-advertisement');
  c.header('Cache-Control', 'no-cache');

  // Return refs
  const result = await new Promise((resolve, reject) => {
    const chunks = ['001e# service=git-upload-pack\n0000'];
    const proc = spawn('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', repoPath]);
    proc.stdout.on('data', d => chunks.push(d));
    proc.on('close', () => resolve(Buffer.concat(chunks.map(c =>
      typeof c === 'string' ? Buffer.from(c) : c
    ))));
  });

  return c.body(result);
});

// Upload-pack endpoint
app.post('/u/:user/:repo.git/git-upload-pack', async (c) => {
  const user = await authenticateRequest(c);
  if (!user) return c.text('Unauthorized', 401);

  const repoPath = await getRepo(user, c.req.param('repo'));
  const body = await c.req.arrayBuffer();

  c.header('Content-Type', 'application/x-git-upload-pack-result');
  c.header('Cache-Control', 'no-cache');

  return new Response(
    new ReadableStream({
      start(controller) {
        const proc = spawn('git', ['upload-pack', '--stateless-rpc', repoPath]);
        proc.stdin.write(Buffer.from(body));
        proc.stdin.end();
        proc.stdout.on('data', d => controller.enqueue(d));
        proc.stdout.on('end', () => controller.close());
      }
    })
  );
});

export default app;
```

## Next Steps

1. **Prototype** the git-upload-pack approach with a simple test repo
2. **Test** with Claude Code to verify it works end-to-end
3. **Add caching** layer once basic functionality works
4. **Optimize** repo generation (consider pre-generating on purchase)

## References

- [Git HTTP Protocol Spec](https://git-scm.com/docs/http-protocol)
- [Git Transfer Protocols (Pro Git)](https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols)
- [git-http-backend manual](https://git-scm.com/docs/git-http-backend)
- [gitolite documentation](https://gitolite.com/gitolite/how.html)
