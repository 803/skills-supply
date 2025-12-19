# CLI Design for Skills Supply

> Implementation details for the `sksup` CLI tool

---

## Overview

The `sksup` CLI authenticates users and configures git credentials so that `git clone` operations against Skills Supply repositories work seamlessly. This document covers the full implementation: commands, auth flow, credential management, distribution, and error handling.

---

## Commands

| Command | Purpose |
|---------|---------|
| `sksup auth` | Authenticate and configure git credentials |
| `sksup status` | Show current auth status and account info |
| `sksup logout` | Remove credentials and deauthorize |
| `sksup whoami` | Show current user |

---

## Auth Flow Implementation

### Overview

1. CLI generates a session token and opens browser
2. User logs in on web (or signs up)
3. CLI polls for completion
4. On success, CLI configures OS-native credential helper
5. CLI stores token in system keychain

### Full Implementation

```typescript
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import open from 'open';

const API_BASE = 'https://skills.supply';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes

interface AuthResponse {
  status: 'pending' | 'completed' | 'expired';
  token?: string;
  username?: string;
  email?: string;
}

export async function auth(): Promise<void> {
  // 1. Generate session token
  const sessionToken = crypto.randomBytes(32).toString('hex');

  // 2. Open browser
  const authUrl = `${API_BASE}/auth/cli?session=${sessionToken}`;
  console.log('Opening browser to authenticate...');
  console.log(`If browser doesn't open, visit: ${authUrl}\n`);
  await open(authUrl);

  // 3. Poll for completion
  console.log('Waiting for authentication...');
  const result = await pollForAuth(sessionToken);

  if (!result) {
    console.error('Authentication timed out. Please try again.');
    process.exit(1);
  }

  // 4. Configure credential helper
  configureCredentialHelper();

  // 5. Store credentials
  storeCredentials(result.username!, result.token!);

  // 6. Success message
  console.log(`\n✓ Authenticated as ${result.email}`);
  console.log(`\nAdd your marketplace to Claude Code:`);
  console.log(`  /plugin marketplace add ${API_BASE}/me/marketplace\n`);
}

async function pollForAuth(sessionToken: string): Promise<AuthResponse | null> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const response = await fetch(`${API_BASE}/auth/cli/status?session=${sessionToken}`);

      if (!response.ok) {
        // Server error, keep polling
        continue;
      }

      const data: AuthResponse = await response.json();

      if (data.status === 'completed') {
        return data;
      }

      if (data.status === 'expired') {
        return null;
      }

      // status === 'pending', continue polling
      process.stdout.write('.');
    } catch (err) {
      // Network error, keep polling
      continue;
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Credential Helper Configuration

### OS-Native Helpers

We use OS-native credential helpers for secure token storage:

| Platform | Helper | Storage Location |
|----------|--------|------------------|
| macOS | `osxkeychain` | Keychain Access |
| Windows | `manager-core` | Windows Credential Manager |
| Linux | `store` | `~/.git-credentials` (fallback) |

### Implementation

```typescript
function getCredentialHelper(): string {
  switch (process.platform) {
    case 'darwin':
      return 'osxkeychain';
    case 'win32':
      return 'manager-core';
    default:
      // Linux and others fall back to store
      return 'store';
  }
}

function configureCredentialHelper(): void {
  const helper = getCredentialHelper();

  // Configure credential helper for skills.supply only
  // This doesn't affect the user's other git operations
  execSync(`git config --global credential.${API_BASE}.helper ${helper}`);
}
```

### Storing Credentials

For `osxkeychain` and `manager-core`, we use `git credential approve`:

```typescript
import { spawn } from 'child_process';

function storeCredentials(username: string, token: string): void {
  const helper = getCredentialHelper();

  if (helper === 'store') {
    // Direct file write for store helper
    storeCredentialsFile(username, token);
  } else {
    // Use git credential interface for OS-native helpers
    storeCredentialsNative(username, token);
  }
}

function storeCredentialsNative(username: string, token: string): void {
  // git credential approve reads from stdin
  const proc = spawn('git', ['credential', 'approve'], {
    stdio: ['pipe', 'inherit', 'inherit']
  });

  proc.stdin.write(`protocol=https\n`);
  proc.stdin.write(`host=skills.supply\n`);
  proc.stdin.write(`username=${username}\n`);
  proc.stdin.write(`password=${token}\n`);
  proc.stdin.write(`\n`);
  proc.stdin.end();
}

function storeCredentialsFile(username: string, token: string): void {
  import * as fs from 'fs';
  import * as os from 'os';
  import * as path from 'path';

  const credentialsPath = path.join(os.homedir(), '.git-credentials');
  const credLine = `https://${username}:${token}@skills.supply\n`;

  // Read existing credentials
  let creds = '';
  if (fs.existsSync(credentialsPath)) {
    creds = fs.readFileSync(credentialsPath, 'utf8');
  }

  // Remove any existing skills.supply credential
  const lines = creds.split('\n').filter(line => !line.includes('skills.supply'));

  // Add new credential
  lines.push(credLine.trim());

  // Write back with secure permissions
  fs.writeFileSync(credentialsPath, lines.join('\n') + '\n', { mode: 0o600 });
}
```

---

## Other Commands

### `sksup status`

```typescript
export async function status(): Promise<void> {
  const creds = getStoredCredentials();

  if (!creds) {
    console.log('Not authenticated.');
    console.log('Run `sksup auth` to authenticate.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/me`, {
      headers: {
        'Authorization': `Bearer ${creds.token}`
      }
    });

    if (!response.ok) {
      console.log('Token is invalid or expired.');
      console.log('Run `sksup auth` to re-authenticate.');
      return;
    }

    const user = await response.json();
    console.log(`Logged in as: ${user.email}`);
    console.log(`Username: ${user.username}`);
    console.log(`Marketplace: ${API_BASE}/me/marketplace`);
  } catch (err) {
    console.error('Failed to fetch account info:', err);
  }
}

function getStoredCredentials(): { username: string; token: string } | null {
  // Use git credential fill to retrieve stored credentials
  try {
    const result = execSync(
      'echo "protocol=https\nhost=skills.supply\n" | git credential fill',
      { encoding: 'utf8' }
    );

    const lines = result.split('\n');
    let username = '';
    let token = '';

    for (const line of lines) {
      if (line.startsWith('username=')) {
        username = line.slice('username='.length);
      }
      if (line.startsWith('password=')) {
        token = line.slice('password='.length);
      }
    }

    if (username && token) {
      return { username, token };
    }
  } catch {
    // No credentials stored
  }

  return null;
}
```

### `sksup logout`

```typescript
export async function logout(): Promise<void> {
  const creds = getStoredCredentials();

  if (!creds) {
    console.log('Not authenticated.');
    return;
  }

  // Remove credentials using git credential reject
  removeCredentials();

  // Optionally revoke token server-side
  try {
    await fetch(`${API_BASE}/api/tokens/revoke`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.token}`
      }
    });
  } catch {
    // Best effort, continue even if server revocation fails
  }

  console.log('Logged out successfully.');
}

function removeCredentials(): void {
  const proc = spawn('git', ['credential', 'reject'], {
    stdio: ['pipe', 'inherit', 'inherit']
  });

  proc.stdin.write(`protocol=https\n`);
  proc.stdin.write(`host=skills.supply\n`);
  proc.stdin.write(`\n`);
  proc.stdin.end();
}
```

### `sksup whoami`

```typescript
export async function whoami(): Promise<void> {
  const creds = getStoredCredentials();

  if (!creds) {
    console.log('Not authenticated.');
    process.exit(1);
  }

  console.log(creds.username);
}
```

---

## CLI Entry Point

```typescript
#!/usr/bin/env node

import { auth, status, logout, whoami } from './commands';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'auth':
      await auth();
      break;
    case 'status':
      await status();
      break;
    case 'logout':
      await logout();
      break;
    case 'whoami':
      await whoami();
      break;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
sksup - Skills Supply CLI

Usage:
  sksup <command>

Commands:
  auth      Authenticate and configure git credentials
  status    Show current auth status and account info
  logout    Remove credentials and deauthorize
  whoami    Show current username

Examples:
  sksup auth          # Open browser to authenticate
  sksup status        # Check if logged in
  sksup logout        # Log out and remove credentials
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

---

## Error Handling

### Network Errors

```typescript
async function fetchWithRetry(url: string, options?: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
  throw new Error('Request failed after retries');
}
```

### Git Not Installed

```typescript
function checkGitInstalled(): void {
  try {
    execSync('git --version', { stdio: 'ignore' });
  } catch {
    console.error('Error: git is not installed or not in PATH.');
    console.error('Please install git and try again.');
    process.exit(1);
  }
}
```

### Credential Helper Not Available

```typescript
function checkCredentialHelper(): void {
  const helper = getCredentialHelper();

  if (helper === 'osxkeychain') {
    // osxkeychain is built into macOS git
    return;
  }

  if (helper === 'manager-core') {
    // Check if Git Credential Manager is installed
    try {
      execSync('git credential-manager-core --version', { stdio: 'ignore' });
    } catch {
      console.warn('Warning: Git Credential Manager not found.');
      console.warn('Falling back to plaintext storage (~/.git-credentials).');
      // Fall back to store
      execSync(`git config --global credential.${API_BASE}.helper store`);
    }
  }
}
```

### Browser Won't Open

```typescript
async function openBrowser(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    // Browser failed to open, user must manually visit
    console.log(`\nCouldn't open browser automatically.`);
    console.log(`Please visit this URL to authenticate:\n`);
    console.log(`  ${url}\n`);
  }
}
```

---

## Distribution

### Build Process

Written in TypeScript, compiled to standalone binary with Bun:

```bash
# Build for all platforms
bun build --compile --target=bun-darwin-arm64 ./src/cli.ts --outfile=dist/sksup-darwin-arm64
bun build --compile --target=bun-darwin-x64 ./src/cli.ts --outfile=dist/sksup-darwin-x64
bun build --compile --target=bun-linux-x64 ./src/cli.ts --outfile=dist/sksup-linux-x64
bun build --compile --target=bun-windows-x64 ./src/cli.ts --outfile=dist/sksup-windows-x64.exe
```

### Platform Targets

| Target | Filename |
|--------|----------|
| macOS Apple Silicon | `sksup-darwin-arm64` |
| macOS Intel | `sksup-darwin-x64` |
| Linux x64 | `sksup-linux-x64` |
| Windows x64 | `sksup-windows-x64.exe` |

### GitHub Releases

Binaries are uploaded to GitHub Releases on each version tag:

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Build binaries
        run: |
          bun build --compile --target=bun-darwin-arm64 ./src/cli.ts --outfile=dist/sksup-darwin-arm64
          bun build --compile --target=bun-darwin-x64 ./src/cli.ts --outfile=dist/sksup-darwin-x64
          bun build --compile --target=bun-linux-x64 ./src/cli.ts --outfile=dist/sksup-linux-x64
          bun build --compile --target=bun-windows-x64 ./src/cli.ts --outfile=dist/sksup-windows-x64.exe

      - name: Upload to Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            dist/sksup-darwin-arm64
            dist/sksup-darwin-x64
            dist/sksup-linux-x64
            dist/sksup-windows-x64.exe
```

### Install Script

`https://skills.supply/install.sh`:

```bash
#!/bin/sh
set -e

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin)
    case "$ARCH" in
      arm64) TARGET="darwin-arm64" ;;
      x86_64) TARGET="darwin-x64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  linux)
    case "$ARCH" in
      x86_64) TARGET="linux-x64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS"
    echo "For Windows, download from: https://github.com/803/skills-supply/releases"
    exit 1
    ;;
esac

# Get latest release URL
RELEASE_URL="https://github.com/803/skills-supply/releases/latest/download/sksup-${TARGET}"

# Download and install
echo "Downloading sksup for ${TARGET}..."
curl -fsSL "$RELEASE_URL" -o /tmp/sksup
chmod +x /tmp/sksup

# Install to /usr/local/bin (may need sudo)
INSTALL_DIR="/usr/local/bin"
if [ -w "$INSTALL_DIR" ]; then
  mv /tmp/sksup "$INSTALL_DIR/sksup"
else
  echo "Installing to $INSTALL_DIR (requires sudo)..."
  sudo mv /tmp/sksup "$INSTALL_DIR/sksup"
fi

echo "✓ sksup installed successfully!"
echo ""
echo "Run 'sksup auth' to get started."
```

### Homebrew Formula

For homebrew-core submission:

```ruby
class Sksup < Formula
  desc "CLI for Skills Supply - marketplace for Claude Code plugins"
  homepage "https://skills.supply"
  version "0.1.0"

  on_macos do
    on_arm do
      url "https://github.com/803/skills-supply/releases/download/v0.1.0/sksup-darwin-arm64"
      sha256 "..." # SHA256 of darwin-arm64 binary
    end
    on_intel do
      url "https://github.com/803/skills-supply/releases/download/v0.1.0/sksup-darwin-x64"
      sha256 "..." # SHA256 of darwin-x64 binary
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/803/skills-supply/releases/download/v0.1.0/sksup-linux-x64"
      sha256 "..." # SHA256 of linux-x64 binary
    end
  end

  def install
    bin.install "sksup-#{OS.mac? ? "darwin" : "linux"}-#{Hardware::CPU.arm? ? "arm64" : "x64"}" => "sksup"
  end

  test do
    assert_match "sksup", shell_output("#{bin}/sksup --help")
  end
end
```

---

## File Structure

```
packages/cli/
├── src/
│   ├── cli.ts                # Entry point
│   ├── commands/
│   │   ├── auth.ts           # Auth command
│   │   ├── status.ts         # Status command
│   │   ├── logout.ts         # Logout command
│   │   └── whoami.ts         # Whoami command
│   ├── credentials/
│   │   ├── helper.ts         # Credential helper detection
│   │   ├── store.ts          # Store credentials
│   │   └── retrieve.ts       # Retrieve credentials
│   └── utils/
│       ├── fetch.ts          # Fetch with retry
│       └── browser.ts        # Open browser
├── package.json
├── tsconfig.json
└── README.md
```

---

## Dependencies

```json
{
  "name": "@skills-supply/sksup",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "sksup": "./dist/cli.js"
  },
  "scripts": {
    "build": "bun build --compile ./src/cli.ts --outfile=dist/sksup",
    "build:all": "./scripts/build-all.sh"
  },
  "dependencies": {
    "open": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## Edge Cases

### Multiple Accounts

Currently not supported. Running `sksup auth` overwrites the existing credential. Future enhancement: support multiple accounts with `sksup auth --profile work`.

### Expired Token

If the stored token is expired, git operations will fail with 401. User should run `sksup auth` again. The server may return a specific error message prompting re-authentication.

### Concurrent Auth Sessions

If user starts auth on multiple machines simultaneously, only the session completed last will have valid credentials. Previous sessions' credentials will be overwritten on next auth.

### Corporate Proxies

Fetch operations use the system's HTTP proxy settings via environment variables (`HTTP_PROXY`, `HTTPS_PROXY`). No special handling needed.

### Headless Environments

On systems without a display (CI, SSH sessions), `open` will fail. The CLI prints the URL for manual copying:

```
Couldn't open browser automatically.
Please visit this URL to authenticate:

  https://skills.supply/auth/cli?session=abc123
```

---

## Testing

### Unit Tests

```typescript
import { describe, it, expect, mock } from 'bun:test';
import { getCredentialHelper } from './credentials/helper';

describe('getCredentialHelper', () => {
  it('returns osxkeychain on macOS', () => {
    mock.module('process', () => ({ platform: 'darwin' }));
    expect(getCredentialHelper()).toBe('osxkeychain');
  });

  it('returns manager-core on Windows', () => {
    mock.module('process', () => ({ platform: 'win32' }));
    expect(getCredentialHelper()).toBe('manager-core');
  });

  it('returns store on Linux', () => {
    mock.module('process', () => ({ platform: 'linux' }));
    expect(getCredentialHelper()).toBe('store');
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from 'bun:test';
import { execSync } from 'child_process';

describe('CLI', () => {
  it('shows help with no args', () => {
    const output = execSync('./dist/sksup', { encoding: 'utf8' });
    expect(output).toContain('Usage:');
    expect(output).toContain('auth');
  });

  it('shows help with --help', () => {
    const output = execSync('./dist/sksup --help', { encoding: 'utf8' });
    expect(output).toContain('Usage:');
  });

  it('exits with error for unknown command', () => {
    expect(() => execSync('./dist/sksup unknown')).toThrow();
  });
});
```

---

## References

- [Git Credential Storage](https://git-scm.com/book/en/v2/Git-Tools-Credential-Storage)
- [git-credential manual](https://git-scm.com/docs/git-credential)
- [Bun compile documentation](https://bun.sh/docs/bundler/executables)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
