# sk Distribution Design

> Design for distributing `sk` CLI via Homebrew and npm

## Overview

**Distribution channels:**
- **npm** (`@skills-supply/sk`): Ships JS bundle. Users need Node.js. Accepts startup overhead for simplicity.
- **Homebrew** (`skills-supply/sk/sk`): Ships standalone binaries for macOS/Linux. No Node.js required.
- **Scoop** (`skills-supply` bucket): Ships standalone binary for Windows. No Node.js required.
- **Chocolatey** (future): Windows package manager. Deferred - Scoop is simpler.

**Design decision**: npm ships JS bundle only (no native binaries). This is simpler than Bun's optionalDependencies pattern and acceptable for sk's use case. Native binary performance is available via Homebrew (macOS/Linux) or Scoop (Windows) for users who need it.

**Repositories:**
```
skills-supply/skillssupply     # Main repo - source code + CI
skills-supply/homebrew-sk      # Homebrew formulas
skills-supply/scoop-sk         # Scoop bucket
```

**Platforms (5 binaries):**
- `sk-darwin-arm64` (Apple Silicon)
- `sk-darwin-x64` (Intel Mac)
- `sk-linux-arm64` (Linux ARM)
- `sk-linux-x64` (Linux x64)
- `sk-windows-x64.exe` (Windows)

---

## Release Flow

```
Developer: npm version patch && git push && git push --tags
                         │
                         ▼
                 ┌──────────────┐
                 │ CI triggers  │  (on: push: tags: ['v*'])
                 └──────┬───────┘
                        │
                        ▼
                  ┌───────────┐
                  │   Build   │  (5 platforms in parallel)
                  │  binaries │
                  └─────┬─────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │  GitHub  │  │   npm    │  │ (waits)  │
    │ Release  │  │ publish  │  │          │
    └────┬─────┘  └──────────┘  └──────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌───────┐
│Homebrew│ │ Scoop │
│  tap   │ │bucket │
└────────┘ └───────┘
```

---

## npm Publishing

**What gets published:**

The existing JS bundle from `bun build ./src/cli.ts --outdir ./dist --target node`.

**package.json changes:**

```json
{
  "name": "@skills-supply/sk",
  "version": "0.2.0",
  "description": "Skills Supply CLI - Install and manage AI agent skills",
  "keywords": ["skills", "ai", "agents", "cli", "claude", "mcp"],
  "homepage": "https://github.com/skills-supply/skillssupply",
  "repository": {
    "type": "git",
    "url": "https://github.com/skills-supply/skillssupply.git"
  },
  "author": "Skills Supply",
  "license": "MIT",
  "bin": {
    "sk": "./dist/cli.js"
  },
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ],
  "type": "module",
  "engines": {
    "node": ">=18"
  }
}
```

Key changes from current:
- Remove `"private": true`
- Add metadata: `description`, `keywords`, `homepage`, `repository`, `author`, `license`
- Add `"files"` to only publish `dist/`, `LICENSE`, `README.md`
- Add `"engines"` for Node version requirement

**User experience:**
```bash
npm install -g @skills-supply/sk
sk --version
```

---

## Homebrew Tap

**New repository: `skills-supply/homebrew-sk`**

```
homebrew-sk/
├── Formula/
│   ├── sk.rb              # Latest version
│   ├── sk@0.2.0.rb        # Versioned formulas (created automatically)
│   ├── sk@0.1.0.rb
│   └── ...
├── scripts/
│   └── update-formula.ts  # Updates formula with new version/hashes
├── README.md
└── LICENSE
```

**Versioned installs:** Users can pin specific versions with `brew install skills-supply/sk/sk@0.2.0`.

**Formula (`Formula/sk.rb`):**

```ruby
class Sk < Formula
  desc "Skills Supply CLI"
  homepage "https://github.com/skills-supply/skillssupply"
  license "MIT"
  version "0.2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/skills-supply/skillssupply/releases/download/v#{version}/sk-darwin-arm64.tar.gz"
      sha256 "abc123..." # sk-darwin-arm64
    else
      url "https://github.com/skills-supply/skillssupply/releases/download/v#{version}/sk-darwin-x64.tar.gz"
      sha256 "def456..." # sk-darwin-x64
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/skills-supply/skillssupply/releases/download/v#{version}/sk-linux-arm64.tar.gz"
      sha256 "ghi789..." # sk-linux-arm64
    else
      url "https://github.com/skills-supply/skillssupply/releases/download/v#{version}/sk-linux-x64.tar.gz"
      sha256 "jkl012..." # sk-linux-x64
    end
  end

  def install
    bin.install "sk"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/sk --version")
  end
end
```

**User experience:**
```bash
brew install skills-supply/sk/sk
sk --version
```

---

## CI Workflow

**File: `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      fail-fast: true  # All-or-nothing: if any platform fails, abort entire release
      matrix:
        include:
          - os: macos-latest
            target: darwin-arm64
          - os: macos-13
            target: darwin-x64
          - os: ubuntu-latest
            target: linux-x64
          - os: ubuntu-24.04-arm
            target: linux-arm64
          - os: windows-latest
            target: windows-x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build:binary  # Compiles to native binary via bun build --compile
      - name: Package (Unix)
        if: runner.os != 'Windows'
        run: tar -czvf sk-${{ matrix.target }}.tar.gz -C bin sk
      - name: Package (Windows)
        if: runner.os == 'Windows'
        run: Compress-Archive -Path bin/sk.exe -DestinationPath sk-${{ matrix.target }}.zip
      - uses: actions/upload-artifact@v4
        with:
          name: sk-${{ matrix.target }}
          path: sk-${{ matrix.target }}.*

  release:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
      - name: Generate checksums
        run: |
          sha256sum sk-*/sk-* > SHASUMS256.txt
          cat SHASUMS256.txt
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            sk-*/sk-*
            SHASUMS256.txt

  npm:
    needs: build  # Wait for all platform builds to succeed before publishing
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/sk
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: .  # Install from repo root
      - run: bun run build:node  # Build JS bundle for npm
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  homebrew:
    needs: release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: skills-supply/homebrew-sk
          token: ${{ secrets.HOMEBREW_TAP_TOKEN }}
      - uses: oven-sh/setup-bun@v2
      - run: bun scripts/update-formula.ts ${{ github.ref_name }}
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "Release ${{ github.ref_name }}"

  scoop:
    needs: release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: skills-supply/scoop-sk
          token: ${{ secrets.SCOOP_BUCKET_TOKEN }}
      - uses: oven-sh/setup-bun@v2
      - run: bun scripts/update-manifest.ts ${{ github.ref_name }}
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "Release ${{ github.ref_name }}"
```

---

## Formula Update Script

**File: `homebrew-sk/scripts/update-formula.ts`**

```typescript
const version = process.argv[2]?.replace(/^v/, "");
if (!version) {
  console.error("Usage: bun update-formula.ts <version>");
  process.exit(1);
}

const REPO = "skills-supply/skillssupply";
const FORMULA_PATH = "Formula/sk.rb";

const platforms = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
];

// Fetch SHASUMS256.txt and parse hashes (faster than downloading all binaries)
const shasumsUrl = `https://github.com/${REPO}/releases/download/v${version}/SHASUMS256.txt`;
const response = await fetch(shasumsUrl);
if (!response.ok) {
  console.error(`Failed to fetch ${shasumsUrl}: ${response.status}`);
  process.exit(1);
}
const shasums = await response.text();
console.log("SHASUMS256.txt:\n" + shasums);

// Parse: "abc123...  sk-darwin-arm64/sk-darwin-arm64.tar.gz"
const hashes: Record<string, string> = {};
for (const line of shasums.trim().split("\n")) {
  const [hash, filename] = line.split(/\s+/);
  const platform = platforms.find((p) => filename.includes(`sk-${p}`));
  if (platform) {
    hashes[platform] = hash;
  }
}

// Update formula with new version and hashes
let formula = await Bun.file(FORMULA_PATH).text();
formula = formula.replace(/version "[^"]+"/, `version "${version}"`);

for (const [platform, hash] of Object.entries(hashes)) {
  const regex = new RegExp(`(sha256 ")[^"]+(" # sk-${platform})`);
  formula = formula.replace(regex, `$1${hash}$2`);
}

await Bun.write(FORMULA_PATH, formula);
console.log(`Updated ${FORMULA_PATH} to v${version}`);

// Create versioned formula (e.g., sk@0.2.0.rb with class SkAT020)
const versionedClass = `class SkAT${version.replace(/\./g, "")}`;
const versionedFormula = formula.replace(/class Sk\b/, versionedClass);
const versionedPath = `Formula/sk@${version}.rb`;
await Bun.write(versionedPath, versionedFormula);
console.log(`Created ${versionedPath}`);
```

---

## Developer Workflow

**To release a new version:**

```bash
# 1. Update version (creates git tag automatically)
npm version patch   # 0.1.0 → 0.1.1

# 2. Push commit and tag together to trigger CI
git push && git push --tags
```

CI handles everything else automatically:
1. Builds native binaries for all 5 platforms
2. Creates GitHub Release with binaries + SHASUMS256.txt
3. Publishes to npm
4. Updates Homebrew tap
5. Updates Scoop bucket

---

## Pre-Release Verification

Before the first release, verify:
- [ ] `bun build --compile` output paths match CI packaging (./bin/sk on Unix, ./bin/sk.exe on Windows)
- [ ] Binary runs correctly on at least one platform per OS (macOS, Linux, Windows)
- [ ] `npm pack` includes expected files (dist/, LICENSE, README.md)

---

## One-Time Setup

1. **Create `skills-supply` GitHub organization**
   - Required for consistent package scoping across npm, Homebrew, and Scoop
   - Transfer `skillssupply` repo to the org (or fork if needed)

2. **Create `skills-supply/homebrew-sk` repo** with:
   - `Formula/sk.rb` (initial formula)
   - `scripts/update-formula.ts`
   - `README.md`

3. **Create `skills-supply/scoop-sk` repo** with:
   - `bucket/sk.json` (initial manifest)
   - Use [ScoopInstaller/BucketTemplate](https://github.com/ScoopInstaller/BucketTemplate) for auto-update workflow

4. **Add secrets to `skillssupply` repo:**
   - `NPM_TOKEN` - npm automation token with publish access
   - `HOMEBREW_TAP_TOKEN` - GitHub PAT with repo write access to homebrew-sk
   - `SCOOP_BUCKET_TOKEN` - GitHub PAT with repo write access to scoop-sk

5. **First npm publish** - Claim the `@skills-supply/sk` package name

6. **Update `packages/sk/package.json`:**
   - Remove `"private": true`
   - Rename `build:bun` script to `build:binary`
   - Add `"files": ["dist", "LICENSE", "README.md"]`
   - Add `"engines": { "node": ">=18" }`
   - Add metadata: description, keywords, repository, author, homepage

7. **Create `packages/sk/README.md`:**
   - npm-specific README with installation and quick start only
   - Different from main repo README (which is comprehensive)

---

## User Installation

```bash
# Homebrew (macOS/Linux - standalone binary, no Node required)
brew install skills-supply/sk/sk

# Scoop (Windows - standalone binary, no Node required)
scoop bucket add skills-supply https://github.com/skills-supply/scoop-sk
scoop install sk

# npm (cross-platform, requires Node.js)
npm install -g @skills-supply/sk
```

---

## Scoop (Windows)

**New repository: `skills-supply/scoop-sk`**

```
scoop-sk/
├── bucket/
│   └── sk.json               # Scoop manifest
├── .github/
│   └── workflows/
│       └── excavate.yml      # Auto-update workflow (from BucketTemplate)
└── README.md
```

**Manifest (`bucket/sk.json`):**

```json
{
    "version": "0.2.0",
    "description": "Skills Supply CLI",
    "homepage": "https://github.com/skills-supply/skillssupply",
    "license": "MIT",
    "architecture": {
        "64bit": {
            "url": "https://github.com/skills-supply/skillssupply/releases/download/v0.2.0/sk-windows-x64.zip",
            "hash": "abc123..."
        }
    },
    "bin": "sk.exe",
    "checkver": "github",
    "autoupdate": {
        "architecture": {
            "64bit": {
                "url": "https://github.com/skills-supply/skillssupply/releases/download/v$version/sk-windows-x64.zip"
            }
        },
        "hash": {
            "url": "$baseurl/SHASUMS256.txt"
        }
    }
}
```

**User experience:**
```powershell
scoop bucket add skills-supply https://github.com/skills-supply/scoop-sk
scoop install sk
sk --version
```

---

## Scoop Manifest Update Script

**File: `scoop-sk/scripts/update-manifest.ts`**

```typescript
const version = process.argv[2]?.replace(/^v/, "");
if (!version) {
  console.error("Usage: bun update-manifest.ts <version>");
  process.exit(1);
}

const REPO = "skills-supply/skillssupply";
const MANIFEST_PATH = "bucket/sk.json";

// Fetch SHASUMS256.txt and parse Windows hash
const shasumsUrl = `https://github.com/${REPO}/releases/download/v${version}/SHASUMS256.txt`;
const response = await fetch(shasumsUrl);
if (!response.ok) {
  console.error(`Failed to fetch ${shasumsUrl}: ${response.status}`);
  process.exit(1);
}
const shasums = await response.text();

// Find Windows x64 hash
let windowsHash = "";
for (const line of shasums.trim().split("\n")) {
  const [hash, filename] = line.split(/\s+/);
  if (filename.includes("sk-windows-x64")) {
    windowsHash = hash;
    break;
  }
}

if (!windowsHash) {
  console.error("Windows hash not found in SHASUMS256.txt");
  process.exit(1);
}

// Update manifest
const manifest = JSON.parse(await Bun.file(MANIFEST_PATH).text());
manifest.version = version;
manifest.architecture["64bit"].url =
  `https://github.com/${REPO}/releases/download/v${version}/sk-windows-x64.zip`;
manifest.architecture["64bit"].hash = windowsHash;

await Bun.write(MANIFEST_PATH, JSON.stringify(manifest, null, 4));
console.log(`Updated ${MANIFEST_PATH} to v${version}`);
```

---

## References

- [Bun distribution analysis](./2025-12-30-homebrew-npm-distribution.md)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [Scoop App Manifests](https://github.com/ScoopInstaller/Scoop/wiki/App-Manifests)
- [Scoop Bucket Template](https://github.com/ScoopInstaller/BucketTemplate)
- [softprops/action-gh-release](https://github.com/softprops/action-gh-release)
