# Homebrew & NPM Distribution for CLI Tools

> Analysis of how Bun (`oven-sh/bun`) distributes its CLI binary

## Overview

This document analyzes how [Bun](https://bun.sh) distributes its CLI binary via Homebrew and npm. Bun is a good reference implementation because it ships native binaries across multiple platforms through both package managers.

## Repository Structure

Bun uses two repositories:

1. **Main repo** (`oven-sh/bun`) - Source code, CI, release automation
2. **Homebrew tap** (`oven-sh/homebrew-bun`) - Homebrew formulas only

## Build Artifacts

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

---

## Developer Release Workflow

### The Trigger: Publishing a GitHub Release

The entire release pipeline is triggered by **publishing a GitHub Release**. A Bun developer:

1. Goes to GitHub UI → Releases → "Draft a new release"
2. Creates a new tag (e.g., `bun-v1.3.6`)
3. Targets the `main` branch
4. Writes release notes
5. Clicks "Publish release"

That's the only manual step. Everything else is automated.

### Release Workflow Configuration

The workflow triggers on the `published` event:

```yaml
# .github/workflows/release.yml
name: Release
concurrency: release

env:
  BUN_VERSION: ${{ github.event.inputs.tag || github.event.release.tag_name || 'canary' }}
  BUN_LATEST: ${{ (github.event.inputs.is-latest || github.event.release.tag_name) && 'true' || 'false' }}

on:
  release:
    types:
      - published
  schedule:
    - cron: "0 14 * * *"  # Daily canary at 6am PST
  workflow_dispatch:
    inputs:
      is-latest:
        description: Is this the latest release?
        type: boolean
        default: false
      tag:
        type: string
        description: What is the release tag? (e.g. "1.0.2", "canary")
        required: true
      use-docker:
        description: Should Docker images be released?
        type: boolean
        default: false
      use-npm:
        description: Should npm packages be published?
        type: boolean
        default: false
      use-homebrew:
        description: Should binaries be released to Homebrew?
        type: boolean
        default: false
      use-s3:
        description: Should binaries be uploaded to S3?
        type: boolean
        default: false
```

### Release Pipeline Flow

```
GitHub Release published
         │
         ▼
    ┌─────────┐
    │  sign   │ ─── GPG signs all release assets
    └────┬────┘
         │
    ┌────┴────┬──────────┬──────────┬─────────┐
    ▼         ▼          ▼          ▼         ▼
┌───────┐ ┌────────┐ ┌────────┐ ┌─────┐ ┌──────┐
│  npm  │ │homebrew│ │ docker │ │ s3  │ │ bump │
└───────┘ └────────┘ └────────┘ └─────┘ └──────┘
```

All jobs run in parallel after signing completes.

### Automatic Version Bump

After a release, the workflow automatically creates a PR to bump the version:

```yaml
bump:
  name: "Bump version"
  runs-on: ubuntu-latest
  if: ${{ github.event_name != 'schedule' }}
  steps:
    - name: Checkout
      uses: actions/checkout@v4
      if: ${{ env.BUN_LATEST == 'true' }}
    - name: Bump version
      uses: ./.github/actions/bump
      if: ${{ env.BUN_LATEST == 'true' }}
      with:
        version: ${{ env.BUN_VERSION }}
        token: ${{ github.token }}
```

The bump action (`/.github/actions/bump/action.yml`):

```yaml
runs:
  using: composite
  steps:
    - name: Run Bump
      shell: bash
      id: bump
      run: |
        set -euo pipefail
        MESSAGE=$(bun ./scripts/bump.ts patch --last-version=${{ inputs.version }})
        LATEST=$(cat LATEST)
        echo "version=$LATEST" >> $GITHUB_OUTPUT
        echo "message=$MESSAGE" >> $GITHUB_OUTPUT
    - name: Create Pull Request
      uses: peter-evans/create-pull-request@v7
      with:
        add-paths: |
          CMakeLists.txt
          LATEST
        commit-message: Bump version to ${{ steps.bump.outputs.version }}
        title: Bump to ${{ steps.bump.outputs.version }}
```

This updates:
- `LATEST` file (contains just the version string, e.g., `1.3.6`)
- `CMakeLists.txt` (build system version)
- `package.json` version

### Canary Releases

Bun publishes daily canary releases automatically:

```yaml
schedule:
  - cron: "0 14 * * *"  # Every day at 6am PST
```

Canary builds get the tag `canary` and are published to npm with `--tag canary`.

### Manual Workflow Dispatch

For special cases, developers can trigger releases manually with selective publishing:

```yaml
workflow_dispatch:
  inputs:
    tag: "1.3.6"
    use-homebrew: true
    use-npm: true
    use-docker: false
    use-s3: false
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
    if Hardware::CPU.arm?
      url "https://github.com/oven-sh/bun/releases/download/bun-v#{version}/bun-linux-aarch64.zip"
      sha256 "ed01000f85bd97785228ad2845dc92a1860b8054856826d7317690ac8f8ee74b"
    elsif Hardware::CPU.avx2?
      url "https://github.com/oven-sh/bun/releases/download/bun-v#{version}/bun-linux-x64.zip"
      sha256 "7051d86a924aefea3e0b96213b5fd8f79c0793f9cae6534233e627e5c3db4669"
    else
      url "https://github.com/oven-sh/bun/releases/download/bun-v#{version}/bun-linux-x64-baseline.zip"
      sha256 "6bddacd6a65855698b9816f2d74871eda4dd0b7fa921140c6445248f94a742fd"
    end
  else
    odie "Unsupported platform. Please submit a bug report here: https://bun.sh/issues\n#{OS.report}"
  end

  def install
    bin.install "bun"
    ENV["BUN_INSTALL"] = "#{bin}"
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
| **Hardware::CPU.arm?** | Detects ARM64 architecture |
| **Hardware::CPU.avx2?** | Detects AVX2 CPU instruction support |
| **Hardware::CPU.in_rosetta2?** | Detects Rosetta 2 emulation on Apple Silicon |

### Homebrew Release Job

```yaml
homebrew:
  name: Release to Homebrew
  runs-on: ubuntu-latest
  needs: sign
  permissions:
    contents: read
  if: ${{ github.event_name == 'release' || github.event.inputs.use-homebrew == 'true' }}
  steps:
    - name: Checkout
      uses: actions/checkout@v4
      with:
        repository: oven-sh/homebrew-bun
        token: ${{ secrets.ROBOBUN_TOKEN }}
    - id: gpg
      name: Setup GPG
      uses: crazy-max/ghaction-import-gpg@v5
      with:
        gpg_private_key: ${{ secrets.GPG_PRIVATE_KEY }}
        passphrase: ${{ secrets.GPG_PASSPHRASE }}
    - name: Setup Ruby
      uses: ruby/setup-ruby@v1
      with:
        ruby-version: "2.6"
    - name: Update Tap
      run: ruby scripts/release.rb "${{ env.BUN_VERSION }}"
    - name: Commit Tap
      uses: stefanzweifel/git-auto-commit-action@v4
      with:
        commit_options: --gpg-sign=${{ steps.gpg.outputs.keyid }}
        commit_message: Release ${{ env.BUN_VERSION }}
        commit_user_name: robobun
        commit_user_email: robobun@oven.sh
        commit_author: robobun <robobun@oven.sh>
```

### Release Automation Script (`scripts/release.rb`)

The script that updates the Homebrew formulas:

```ruby
require "net/http"
require "json"
require "digest"

version = ARGV[0]
if version == nil
  abort "Usage: release.rb [x.y.z]"
else
  version = version.gsub(/[a-z-]*/i, "")  # Strip "bun-v" prefix
end

puts "Releasing Bun on Homebrew: v#{version}"

# Fetch release from GitHub API
url = "https://api.github.com/repos/oven-sh/bun/releases/tags/bun-v#{version}"
response = Net::HTTP.get_response(URI(url))
unless response.is_a?(Net::HTTPSuccess)
  abort "Did not find release: bun-v#{version} [status: #{response.code}]"
end

release = JSON.parse(response.body)
puts "Found release: #{release["name"]}"

# Download each asset and compute SHA256
assets = {}
for asset in release["assets"]
  filename = asset["name"]
  if !filename.end_with?(".zip") || filename.include?("-profile")
    puts "Skipped asset: #{filename}"
    next
  end

  url = asset["browser_download_url"]
  begin
    response = Net::HTTP.get_response(URI(url))
    url = response["location"]
  end while response.is_a?(Net::HTTPRedirection)

  unless response.is_a?(Net::HTTPSuccess)
    abort "Did not find asset: #{filename} [status: #{response.code}]"
  end

  sha256 = Digest::SHA256.hexdigest(response.body)
  puts "Found asset: #{filename} [sha256: #{sha256}]"

  assets[filename] = sha256
end

# Update Formula/bun.rb with new version and hashes
formula = ""
File.open("Formula/bun.rb", "r") do |file|
  file.each_line do |line|
    query = line.strip

    new_line = if query.start_with?("version")
      line.gsub(/"[0-9\.]{1,}"/, "\"#{version}\"")
    elsif query.start_with?("sha256")
      # Match hash to asset by filename in comment
      asset = query[(query.index("#") + 2)..-1].strip
      sha256 = assets[asset]
      if sha256 == nil
        abort "Did not find sha256: #{asset}"
      end
      line.gsub(/"[A-Fa-f0-9]{1,}"/, "\"#{sha256}\"")
    else
      line
    end

    formula += new_line
  end
end

# Create versioned formula (e.g., bun@1.3.5.rb with class BunAT135)
versioned_class = "class BunAT#{version.gsub(/\./, "")}"
versioned_formula = formula.gsub(/class Bun/, versioned_class)
File.write("Formula/bun@#{version}.rb", versioned_formula)
puts "Saved Formula/bun@#{version}.rb"

# Update main formula
File.write("Formula/bun.rb", formula)
puts "Saved Formula/bun.rb"

# Update README example version
readme = File.read("README.md")
new_readme = readme.gsub(/bun@[0-9]{1,}\.[0-9]{1,}\.[0-9]{1,}/, "bun@#{version}")
File.write("README.md", new_readme)
puts "Saved README.md"

puts "Done"
```

Key details:
- Fetches release metadata from GitHub API
- Downloads each `.zip` asset to compute SHA256 (doesn't trust GitHub's hashes)
- Updates formulas by regex-replacing version and sha256 lines
- The sha256 lines have comments with the filename (e.g., `# bun-darwin-aarch64.zip`) which the script uses to match hashes to the correct line
- Creates both `bun.rb` (latest) and `bun@x.y.z.rb` (versioned)

---

## NPM Distribution

### The Challenge

npm packages are platform-agnostic by default. Bun needs to ship a native binary for the user's specific platform without downloading binaries for all platforms.

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

The main package contains no binary - just a postinstall script and optionalDependencies:

```json
{
  "name": "bun",
  "version": "1.3.5",
  "description": "Bun is a fast all-in-one JavaScript runtime.",
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
    "@oven/bun-linux-aarch64-musl": "1.3.5",
    "@oven/bun-linux-x64-musl": "1.3.5",
    "@oven/bun-linux-x64-musl-baseline": "1.3.5",
    "@oven/bun-windows-x64": "1.3.5",
    "@oven/bun-windows-x64-baseline": "1.3.5"
  },
  "os": ["darwin", "linux", "win32"],
  "cpu": ["arm64", "x64"],
  "keywords": ["bun", "bun.js", "node", "node.js", "runtime"],
  "homepage": "https://bun.com",
  "license": "MIT",
  "repository": "https://github.com/oven-sh/bun"
}
```

The `bin/bun.exe` file is a **placeholder** that gets replaced by the postinstall script.

### Platform Package (`@oven/bun-darwin-aarch64`)

Each platform package contains just the binary and platform constraints:

```json
{
  "name": "@oven/bun-darwin-aarch64",
  "version": "1.3.5",
  "description": "This is the macOS arm64 binary for Bun.",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "preferUnplugged": true,
  "homepage": "https://bun.com",
  "license": "MIT",
  "repository": "https://github.com/oven-sh/bun"
}
```

The `os` and `cpu` fields tell npm to **only download this package on matching platforms**.

### Platform Detection (`packages/bun-release/src/platform.ts`)

```typescript
export type Platform = {
  os: string;
  arch: string;
  abi?: "musl";
  avx2?: boolean;
  bin: string;
  exe: string;
};

export const platforms: Platform[] = [
  { os: "darwin", arch: "arm64", bin: "bun-darwin-aarch64", exe: "bin/bun" },
  { os: "darwin", arch: "x64", avx2: true, bin: "bun-darwin-x64", exe: "bin/bun" },
  { os: "darwin", arch: "x64", bin: "bun-darwin-x64-baseline", exe: "bin/bun" },
  { os: "linux", arch: "arm64", bin: "bun-linux-aarch64", exe: "bin/bun" },
  { os: "linux", arch: "x64", avx2: true, bin: "bun-linux-x64", exe: "bin/bun" },
  { os: "linux", arch: "x64", bin: "bun-linux-x64-baseline", exe: "bin/bun" },
  { os: "linux", arch: "arm64", abi: "musl", bin: "bun-linux-aarch64-musl", exe: "bin/bun" },
  { os: "linux", arch: "x64", abi: "musl", avx2: true, bin: "bun-linux-x64-musl", exe: "bin/bun" },
  { os: "linux", arch: "x64", abi: "musl", bin: "bun-linux-x64-musl-baseline", exe: "bin/bun" },
  { os: "win32", arch: "x64", avx2: true, bin: "bun-windows-x64", exe: "bin/bun.exe" },
  { os: "win32", arch: "x64", bin: "bun-windows-x64-baseline", exe: "bin/bun.exe" },
];

// Detection helpers
function isLinuxMusl(): boolean {
  return exists("/etc/alpine-release");
}

function isLinuxAVX2(): boolean {
  return read("/proc/cpuinfo").includes("avx2");
}

function isDarwinAVX2(): boolean {
  const { stdout } = spawn("sysctl", ["-n", "machdep.cpu"]);
  return stdout.includes("AVX2");
}

function isRosetta2(): boolean {
  const { stdout } = spawn("sysctl", ["-n", "sysctl.proc_translated"]);
  return stdout.includes("1");
}

function isWindowsAVX2(): boolean {
  return spawn("powershell", ["-c", `...IsProcessorFeaturePresent(40);`]).stdout.trim() === "True";
}
```

### Postinstall Script Logic

The postinstall (`packages/bun-release/src/npm/install.ts`) handles multiple fallback strategies:

```typescript
export async function importBun(): Promise<string> {
  if (!supportedPlatforms.length) {
    throw new Error(`Unsupported platform: ${os} ${arch} ${abi || ""}`);
  }
  for (const platform of supportedPlatforms) {
    try {
      return await requireBun(platform);
    } catch (error) {
      debug("requireBun failed", error);
    }
  }
  throw new Error(`Failed to install package "${module}"`);
}

async function requireBun(platform: Platform): Promise<string> {
  const module = `${owner}/${platform.bin}`;

  function resolveBun() {
    // Try to find the binary in the installed optional dependency
    const exe = require.resolve(join(module, platform.exe));
    const { exitCode } = spawn(exe, ["--version"]);
    if (exitCode === 0) return exe;
    throw new Error("Binary not executable");
  }

  try {
    return resolveBun();
  } catch (cause) {
    // Fallback 1: Try npm install of specific platform package
    error(`Failed to find package "${module}". Trying npm install...`);
  }

  try {
    installBun(platform, cwd);  // Runs: npm install @oven/bun-{platform}@{version}
  } catch (cause) {
    // Fallback 2: Direct download from npm registry
    await downloadBun(platform, cwd);
  }

  return resolveBun();
}

export function optimizeBun(path: string): void {
  // Move binary to bin/bun.exe placeholder location
  rename(path, join(__dirname, "bin", "bun.exe"));
  // Create bunx symlink
  link(join(__dirname, "bin", "bun.exe"), join(__dirname, "bin", "bunx.exe"));
}
```

### NPM Release Job

```yaml
npm:
  name: Release to NPM
  runs-on: ubuntu-latest
  needs: sign
  if: ${{ github.event_name != 'workflow_dispatch' || github.event.inputs.use-npm == 'true' }}
  permissions:
    contents: read
  defaults:
    run:
      working-directory: packages/bun-release
  steps:
    - name: Checkout
      uses: actions/checkout@v4
      with:
        ref: main
    - name: Setup Bun
      uses: ./.github/actions/setup-bun
      with:
        bun-version: "1.2.3"
    - name: Install Dependencies
      run: bun install
    - name: Release
      run: bun upload-npm -- "${{ env.BUN_VERSION }}" publish
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### NPM Upload Script (`packages/bun-release/scripts/upload-npm.ts`)

The script builds and publishes all packages:

```typescript
const module = "bun";
const owner = "@oven";

const [tag, action] = process.argv.slice(2);
const release = await getRelease(tag);
const version = await getSemver(release.tag_name);

async function build(): Promise<void> {
  await buildRootModule();
  for (const platform of platforms) {
    await buildModule(release, platform);
  }
}

async function buildRootModule() {
  // Generate package.json with optionalDependencies
  writeJson(join(cwd, "package.json"), {
    name: module,
    version: version,
    scripts: { postinstall: "node install.js" },
    optionalDependencies: Object.fromEntries(
      platforms.map(({ bin }) => [`${owner}/${bin}`, version])
    ),
    bin: { bun: "bin/bun.exe", bunx: "bin/bunx.exe" },
    os: [...new Set(platforms.map(({ os }) => os))],
    cpu: [...new Set(platforms.map(({ arch }) => arch))],
  });

  // Bundle postinstall script
  bundle("scripts/npm-postinstall.ts", join(cwd, "install.js"));

  // Create placeholder binaries
  write(join(cwd, "bin", "bun.exe"), "");
  write(join(cwd, "bin", "bunx.exe"), "");
}

async function buildModule(release, { bin, exe, os, arch }: Platform) {
  // Download binary from GitHub release
  const asset = release.assets.find(({ name }) => name === `${bin}.zip`);
  const bun = await extractFromZip(asset.browser_download_url, `${bin}/bun`);

  // Write binary to package
  write(join(cwd, exe), await bun.async("arraybuffer"));
  chmod(join(cwd, exe), 0o755);

  // Generate package.json
  writeJson(join(cwd, "package.json"), {
    name: `${owner}/${bin}`,
    version: version,
    os: [os],
    cpu: [arch],
    preferUnplugged: true,
  });
}

async function publish(dryRun?: boolean) {
  for (const module of [...platforms.map(p => `${owner}/${p.bin}`), "bun"]) {
    spawn("npm", [
      "publish",
      "--access", "public",
      "--tag", version.includes("canary") ? "canary" : "latest",
    ], { cwd: join("npm", module) });
  }
}
```

---

## Other Distribution Channels

### S3 Upload (for `bun upgrade`)

Bun uploads binaries to S3/R2 for its self-upgrade command:

```yaml
s3:
  name: Upload to S3
  runs-on: ubuntu-latest
  needs: sign
  steps:
    - run: bun upload-s3 -- "${{ env.BUN_VERSION }}"
      env:
        AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
        AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        AWS_ENDPOINT: ${{ secrets.AWS_ENDPOINT }}
        AWS_BUCKET: bun
```

### Docker Images

Bun publishes multiple Docker variants:

```yaml
docker:
  strategy:
    matrix:
      include:
        - variant: debian
          suffix: ""
        - variant: debian
          suffix: -debian
        - variant: slim
          suffix: -slim
        - variant: alpine
          suffix: -alpine
        - variant: distroless
          suffix: -distroless
```

### Sentry Release Notification

```yaml
notify-sentry:
  name: Notify Sentry
  runs-on: ubuntu-latest
  needs: s3
  steps:
    - uses: getsentry/action-release@v1.7.0
      with:
        version: ${{ env.BUN_VERSION }}
        environment: production
```

---

## Version Management

### Version Files

Bun tracks versions in multiple places:

| File | Purpose |
|------|---------|
| `LATEST` | Single line with current version (e.g., `1.3.5`) |
| `package.json` | npm workspace root version |
| `CMakeLists.txt` | Build system version |

### Tag Format

Bun uses the tag format `bun-v1.3.5` (not just `v1.3.5`).

The release script strips the prefix:
```ruby
version = version.gsub(/[a-z-]*/i, "")  # "bun-v1.3.5" → "1.3.5"
```

---

## References

- [Bun's homebrew-bun repo](https://github.com/oven-sh/homebrew-bun)
- [Bun's release workflow](https://github.com/oven-sh/bun/blob/main/.github/workflows/release.yml)
- [Bun's bun-release package](https://github.com/oven-sh/bun/tree/main/packages/bun-release)
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- [npm optionalDependencies](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#optionaldependencies)
