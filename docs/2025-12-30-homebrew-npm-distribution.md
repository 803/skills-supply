# Homebrew & NPM Distribution for CLI Tools

> Analysis of Bun's distribution system and plan for SK

## Overview

This document analyzes how [Bun](https://bun.sh) distributes its CLI binary via Homebrew and npm, and outlines what SK needs to implement a similar system.

## Bun's Distribution Architecture

### Repository Structure

Bun uses two repositories:

1. **Main repo** (`oven-sh/bun`) - Source code, CI, release automation
2. **Homebrew tap** (`oven-sh/homebrew-bun`) - Homebrew formulas only

### Build Artifacts

Bun's CI (Buildkite) compiles platform-specific binaries uploaded to GitHub Releases:

| Artifact | Platform |
|----------|----------|
| `bun-darwin-aarch64.zip` | macOS Apple Silicon |
| `bun-darwin-x64.zip` | macOS Intel (AVX2) |
| `bun-darwin-x64-baseline.zip` | macOS Intel (no AVX2) |
| `bun-linux-aarch64.zip` | Linux ARM64 |
| `bun-linux-x64.zip` | Linux x64 (AVX2) |
| `bun-linux-x64-baseline.zip` | Linux x64 (no AVX2) |
| `bun-linux-aarch64-musl.zip` | Alpine ARM64 |
| `bun-linux-x64-musl.zip` | Alpine x64 |
| `bun-windows-x64.zip` | Windows x64 |

### Release Pipeline

When a GitHub Release is published, `.github/workflows/release.yml` triggers parallel jobs:

```
release published
       │
       ▼
    ┌──────┐
    │ sign │ ─── GPG signs all assets
    └──┬───┘
       │
       ├────────────────┬────────────────┬────────────────┐
       ▼                ▼                ▼                ▼
   ┌───────┐       ┌─────────┐      ┌────────┐       ┌─────┐
   │  npm  │       │homebrew │      │ docker │       │ s3  │
   └───────┘       └─────────┘      └────────┘       └─────┘
```

---

## Homebrew Distribution

### Tap Repository Structure

```
homebrew-bun/
├── Formula/
│   ├── bun.rb              # Latest version (what `brew install bun` uses)
│   ├── bun@1.3.5.rb        # Versioned formula
│   ├── bun@1.3.4.rb
│   └── ... (157 versioned formulas)
├── scripts/
│   └── release.rb          # Automation script
├── README.md
└── LICENSE
```

### Formula Anatomy (`Formula/bun.rb`)

```ruby
class Bun < Formula
  desc "Incredibly fast JavaScript runtime, bundler, transpiler and package manager"
  homepage "https://bun.sh/"
  license "MIT"
  version "1.3.5"

  # Tells Homebrew how to check for new versions
  livecheck do
    url "https://github.com/oven-sh/bun/releases/latest"
    regex(%r{href=.*?/tag/bun-v?(\d+(?:\.\d+)+)["' >]}i)
  end

  # Platform-specific binary URLs with SHA256 verification
  if OS.mac?
    if Hardware::CPU.arm? || Hardware::CPU.in_rosetta2?
      url "https://github.com/oven-sh/bun/releases/download/bun-v#{version}/bun-darwin-aarch64.zip"
      sha256 "db17588a4aea8804856825d4bead3f05e1f37276ca606f37e369b4f72f35d3fb"
    elsif Hardware::CPU.avx2?
      url "https://github.com/oven-sh/bun/releases/download/bun-v#{version}/bun-darwin-x64.zip"
      sha256 "f5ffc03030fe527a86295fb5852bb08c5e99b707560011d1d509ab028902bf29"
    else
      url "https://github.com/oven-sh/bun/releases/download/bun-v#{version}/bun-darwin-x64-baseline.zip"
      sha256 "34b9a56b851058dafa1bc9d61233f2c383aa996889bba30b3180f5ccc2cff1b2"
    end
  elsif OS.linux?
    # Similar ARM/x64/baseline variants...
  else
    odie "Unsupported platform"
  end

  def install
    bin.install "bun"
    generate_completions_from_executable(bin/"bun", "completions")
  end

  def test
    assert_match "#{version}", shell_output("#{bin}/bun -v")
  end
end
```

### Key Homebrew Concepts

| Concept | Description |
|---------|-------------|
| **Tap** | Third-party formula repository. Format: `user/repo` maps to `github.com/user/homebrew-repo` |
| **Formula** | Ruby file describing how to install a package |
| **Cask** | For GUI apps (not relevant for CLI tools) |
| **livecheck** | Tells `brew audit` how to check for updates |
| **optionalDependencies** | Platform-specific downloads (handled by `if OS.mac?` etc.) |

### Release Automation (`scripts/release.rb`)

The release script:

1. Takes version as argument: `ruby scripts/release.rb 1.3.6`
2. Fetches GitHub Release via API
3. Downloads each `.zip` asset and computes SHA256
4. Updates `Formula/bun.rb`:
   - Replaces `version "x.y.z"`
   - Replaces each `sha256` with new hash (matched by filename comment)
5. Creates versioned formula `Formula/bun@1.3.6.rb` with class `BunAT136`
6. Updates README

The main repo's release workflow calls this script:

```yaml
homebrew:
  name: Release to Homebrew
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        repository: oven-sh/homebrew-bun
        token: ${{ secrets.ROBOBUN_TOKEN }}
    - uses: ruby/setup-ruby@v1
      with:
        ruby-version: "2.6"
    - run: ruby scripts/release.rb "${{ env.BUN_VERSION }}"
    - uses: stefanzweifel/git-auto-commit-action@v4
      with:
        commit_message: Release ${{ env.BUN_VERSION }}
```

---

## NPM Distribution

### The Challenge

npm packages are platform-agnostic by default. Bun needs to ship a native binary for the user's specific platform.

### Solution: Optional Dependencies

Bun publishes **one main package** + **multiple platform packages**:

```
npm packages:
├── bun                        # Main package (users install this)
├── @oven/bun-darwin-aarch64   # macOS ARM64 binary
├── @oven/bun-darwin-x64       # macOS x64 binary
├── @oven/bun-linux-aarch64    # Linux ARM64 binary
├── @oven/bun-linux-x64        # Linux x64 binary
└── @oven/bun-windows-x64      # Windows x64 binary
```

### Main Package (`bun`)

```json
{
  "name": "bun",
  "version": "1.3.5",
  "bin": {
    "bun": "bin/bun.exe",
    "bunx": "bin/bunx.exe"
  },
  "scripts": {
    "postinstall": "node install.js"
  },
  "optionalDependencies": {
    "@oven/bun-darwin-aarch64": "1.3.5",
    "@oven/bun-darwin-x64": "1.3.5",
    "@oven/bun-darwin-x64-baseline": "1.3.5",
    "@oven/bun-linux-aarch64": "1.3.5",
    "@oven/bun-linux-x64": "1.3.5",
    "@oven/bun-linux-x64-baseline": "1.3.5",
    "@oven/bun-windows-x64": "1.3.5",
    "@oven/bun-windows-x64-baseline": "1.3.5"
  },
  "os": ["darwin", "linux", "win32"],
  "cpu": ["arm64", "x64"]
}
```

### Platform Package (`@oven/bun-darwin-aarch64`)

```json
{
  "name": "@oven/bun-darwin-aarch64",
  "version": "1.3.5",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "preferUnplugged": true
}
```

The `os` and `cpu` fields tell npm to **only download this package on matching platforms**.

### Postinstall Script

The `install.js` postinstall script:

1. Detects current platform (OS, arch, AVX2 support, musl vs glibc)
2. Finds the installed platform package via `require.resolve('@oven/bun-darwin-aarch64/bin/bun')`
3. Copies/links the binary to `bin/bun.exe` (the placeholder)
4. **Fallback 1**: If package missing, runs `npm install @oven/bun-{platform}@{version}`
5. **Fallback 2**: If that fails, downloads directly from `registry.npmjs.org`

### Platform Detection (`src/platform.ts`)

```typescript
export const platforms: Platform[] = [
  { os: "darwin", arch: "arm64", bin: "bun-darwin-aarch64", exe: "bin/bun" },
  { os: "darwin", arch: "x64", avx2: true, bin: "bun-darwin-x64", exe: "bin/bun" },
  { os: "darwin", arch: "x64", bin: "bun-darwin-x64-baseline", exe: "bin/bun" },
  { os: "linux", arch: "arm64", bin: "bun-linux-aarch64", exe: "bin/bun" },
  { os: "linux", arch: "x64", avx2: true, bin: "bun-linux-x64", exe: "bin/bun" },
  { os: "linux", arch: "x64", bin: "bun-linux-x64-baseline", exe: "bin/bun" },
  { os: "linux", arch: "arm64", abi: "musl", bin: "bun-linux-aarch64-musl", exe: "bin/bun" },
  { os: "win32", arch: "x64", avx2: true, bin: "bun-windows-x64", exe: "bin/bun.exe" },
  // ...
];

// Detection helpers
function isLinuxMusl(): boolean {
  return exists("/etc/alpine-release");
}

function isDarwinAVX2(): boolean {
  const { stdout } = spawn("sysctl", ["-n", "machdep.cpu"]);
  return stdout.includes("AVX2");
}
```

---

## SK Distribution Plan

### Simplified Scope

SK can start simpler than Bun:

| Bun Has | SK Needs (MVP) |
|---------|----------------|
| 11 platform variants | 4 platforms |
| AVX2 detection | Skip for now |
| musl variants | Skip for now |
| Windows support | Skip for now |

### Target Platforms (MVP)

```
sk-darwin-arm64   # macOS Apple Silicon
sk-darwin-x64     # macOS Intel
sk-linux-arm64    # Linux ARM64
sk-linux-x64      # Linux x64
```

### Repository Structure

**Option A: Separate tap repo (like Bun)**
```
skillssupply/          # Main repo
homebrew-sk/           # Tap repo
```

**Option B: Tap in main repo**
```
skillssupply/
├── packages/sk/       # CLI source
├── homebrew/          # Tap formulas
│   └── Formula/
│       └── sk.rb
└── .github/workflows/release.yml
```

Recommendation: **Option A** - keeps concerns separate, easier to maintain.

### Homebrew Tap (`homebrew-sk`)

```
homebrew-sk/
├── Formula/
│   └── sk.rb
├── scripts/
│   └── release.ts     # Use TS since SK is a TS project
└── README.md
```

**Formula/sk.rb:**
```ruby
class Sk < Formula
  desc "Universal package manager for AI agent skills"
  homepage "https://skillssupply.com"
  license "MIT"
  version "0.1.0"

  livecheck do
    url "https://github.com/your-org/skillssupply/releases/latest"
    regex(%r{href=.*?/tag/v?(\d+(?:\.\d+)+)["' >]}i)
  end

  if OS.mac?
    if Hardware::CPU.arm?
      url "https://github.com/your-org/skillssupply/releases/download/v#{version}/sk-darwin-arm64.tar.gz"
      sha256 "TODO"
    else
      url "https://github.com/your-org/skillssupply/releases/download/v#{version}/sk-darwin-x64.tar.gz"
      sha256 "TODO"
    end
  elsif OS.linux?
    if Hardware::CPU.arm?
      url "https://github.com/your-org/skillssupply/releases/download/v#{version}/sk-linux-arm64.tar.gz"
      sha256 "TODO"
    else
      url "https://github.com/your-org/skillssupply/releases/download/v#{version}/sk-linux-x64.tar.gz"
      sha256 "TODO"
    end
  end

  def install
    bin.install "sk"
  end

  def test
    assert_match version.to_s, shell_output("#{bin}/sk --version")
  end
end
```

### NPM Packages

```
@sk/cli                 # Main package
@sk/darwin-arm64        # Platform packages
@sk/darwin-x64
@sk/linux-arm64
@sk/linux-x64
```

### GitHub Actions Workflow

```yaml
name: Release

on:
  release:
    types: [published]

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-14        # ARM64 runner
            target: darwin-arm64
          - os: macos-13        # x64 runner
            target: darwin-x64
          - os: ubuntu-latest
            target: linux-x64
          - os: ubuntu-24.04-arm64
            target: linux-arm64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build:binary --target=${{ matrix.target }}
      - run: |
          tar -czvf sk-${{ matrix.target }}.tar.gz sk
      - uses: actions/upload-artifact@v4
        with:
          name: sk-${{ matrix.target }}
          path: sk-${{ matrix.target }}.tar.gz

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v1
        with:
          files: |
            sk-darwin-arm64/sk-darwin-arm64.tar.gz
            sk-darwin-x64/sk-darwin-x64.tar.gz
            sk-linux-arm64/sk-linux-arm64.tar.gz
            sk-linux-x64/sk-linux-x64.tar.gz

  homebrew:
    needs: release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: your-org/homebrew-sk
          token: ${{ secrets.HOMEBREW_TAP_TOKEN }}
      - uses: oven-sh/setup-bun@v1
      - run: bun scripts/release.ts ${{ github.event.release.tag_name }}
      - uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: "Release ${{ github.event.release.tag_name }}"

  npm:
    needs: release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - uses: actions/download-artifact@v4
      - run: bun scripts/publish-npm.ts ${{ github.event.release.tag_name }}
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Build Binary

SK is TypeScript - needs to be compiled to a single executable. Options:

1. **Bun's `bun build --compile`** - Single binary, includes Bun runtime
2. **pkg** - Node.js binary compiler
3. **esbuild + Node SEA** - Node.js Single Executable Applications

Recommendation: **Bun's compile** - already using Bun, produces small binaries.

```bash
bun build ./packages/sk/src/cli.ts --compile --outfile=sk
```

---

## Implementation Checklist

### Phase 1: Local Build
- [ ] Add `bun build --compile` script to build single binary
- [ ] Test binary works on current platform
- [ ] Add binary to `.gitignore`

### Phase 2: GitHub Actions Build
- [ ] Create release workflow with matrix build
- [ ] Build binaries for all 4 platforms
- [ ] Upload binaries to GitHub Release

### Phase 3: Homebrew Tap
- [ ] Create `homebrew-sk` repository
- [ ] Write `Formula/sk.rb`
- [ ] Write `scripts/release.ts` to update formula
- [ ] Add homebrew job to release workflow
- [ ] Test: `brew install your-org/sk/sk`

### Phase 4: NPM Distribution
- [ ] Create `@sk/cli` main package
- [ ] Create `@sk/darwin-arm64` etc. platform packages
- [ ] Write postinstall script
- [ ] Write `scripts/publish-npm.ts`
- [ ] Add npm job to release workflow
- [ ] Test: `npm install -g @sk/cli`

---

## References

- [Bun's homebrew-bun repo](https://github.com/oven-sh/homebrew-bun)
- [Bun's release workflow](https://github.com/oven-sh/bun/blob/main/.github/workflows/release.yml)
- [Bun's bun-release package](https://github.com/oven-sh/bun/tree/main/packages/bun-release)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [npm optionalDependencies](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#optionaldependencies)
- [Bun compile docs](https://bun.sh/docs/bundler/executables)
