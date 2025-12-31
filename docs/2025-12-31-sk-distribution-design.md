# sk Distribution Design

> Design for distributing `sk` CLI via Homebrew and npm

## Overview

**Distribution channels:**
- **npm** (`@skills-supply/sk`): Ships JS bundle. Users need Node.js.
- **Homebrew** (`skills-supply/sk/sk`): Ships standalone binaries. No Node.js required.

**Repositories:**
```
skills-supply/skillssupply     # Main repo - source code + CI
skills-supply/homebrew-sk      # New repo - Homebrew formulas only
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
Developer: npm version patch && git push --tags
                    │
                    ▼
            ┌──────────────┐
            │ CI triggers  │  (on: push: tags: ['v*'])
            └──────┬───────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
   ┌───────┐  ┌────────┐  ┌──────────┐
   │ Build │  │ Create │  │  Publish │
   │ bins  │  │ GH Rel │  │   npm    │
   └───┬───┘  └────────┘  └──────────┘
       │
       ▼
   ┌──────────┐
   │ Update   │
   │ Homebrew │
   │   tap    │
   └──────────┘
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
  "bin": {
    "sk": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "type": "module",
  "engines": {
    "node": ">=18"
  }
}
```

Key changes from current:
- Remove `"private": true`
- Add `"files"` to only publish `dist/`
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
│   └── sk.rb              # Main formula
├── scripts/
│   └── update-formula.ts  # Updates formula with new version/hashes
├── README.md
└── LICENSE
```

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
      - run: bun run bundle
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
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            sk-*/sk-*

  npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
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

// Fetch release assets and compute SHA256 hashes
const hashes: Record<string, string> = {};
for (const platform of platforms) {
  const url = `https://github.com/${REPO}/releases/download/v${version}/sk-${platform}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch ${url}: ${response.status}`);
    process.exit(1);
  }
  const buffer = await response.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256")
    .update(new Uint8Array(buffer))
    .digest("hex");
  hashes[platform] = hash;
  console.log(`${platform}: ${hash}`);
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
```

---

## Developer Workflow

**To release a new version:**

```bash
# 1. Update version (creates git tag automatically)
npm version patch   # 0.1.0 → 0.1.1

# 2. Push tag to trigger CI
git push --tags
```

CI handles everything else automatically.

---

## One-Time Setup

1. **Create `skills-supply/homebrew-sk` repo** with:
   - `Formula/sk.rb` (initial formula)
   - `scripts/update-formula.ts`
   - `README.md`

2. **Add secrets to `skillssupply` repo:**
   - `NPM_TOKEN` - npm automation token with publish access
   - `HOMEBREW_TAP_TOKEN` - GitHub PAT with repo write access to homebrew-sk

3. **First npm publish** - Claim the `@skills-supply/sk` package name

4. **Update `packages/sk/package.json`:**
   - Remove `"private": true`
   - Add `"files": ["dist"]`
   - Add `"engines": { "node": ">=18" }`

---

## User Installation

```bash
# Homebrew (standalone binary, no Node required)
brew install skills-supply/sk/sk

# npm (requires Node.js)
npm install -g @skills-supply/sk
```

---

## References

- [Bun distribution analysis](./2025-12-30-homebrew-npm-distribution.md)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [softprops/action-gh-release](https://github.com/softprops/action-gh-release)
