# Cargo Package Manager Research

> Research conducted 2025-12-31 comparing Cargo (Rust) to sk design

## 1. How Cargo Determines Project Boundaries

**Answer: Cargo uses `Cargo.toml` discovery, NOT git boundaries.**

Cargo finds the project root by:
1. **Upward search from CWD**: Starting from the current working directory, Cargo searches upward for a file named `Cargo.toml`
2. **First match wins**: The first `Cargo.toml` found becomes the project manifest
3. **Workspace extension**: If that manifest is part of a workspace, Cargo continues upward or uses `package.workspace` to find the workspace root

From the official docs (`cargo locate-project`):
> "The manifest is found by searching upward for a file named `Cargo.toml` starting from the current working directory."

**Key difference from sk's design**: Cargo does NOT use git boundaries. The project boundary is purely determined by the presence of `Cargo.toml`. A workspace can span multiple git repos or be nested within one.

## 2. Global vs Project Dependencies

**Answer: Cargo has a clear separation, but different from sk's model.**

### Project Dependencies (Cargo.toml)
- Defined in `Cargo.toml` under `[dependencies]`
- Downloaded to `~/.cargo/registry/` (shared cache)
- Compiled to `./target/` (project-local)

### "Global" Binaries (cargo install)
- `cargo install <crate>` installs executable binaries
- Default location: `$CARGO_HOME/bin/` (typically `~/.cargo/bin/`)
- NOT project dependencies - these are standalone tools

**Important distinction**: Cargo doesn't have "global dependencies" in the npm sense. Dependencies are ALWAYS project-scoped. What's "global" is:
1. The registry cache (shared across all projects)
2. Installed binary tools (via `cargo install`)

## 3. Configuration Inheritance/Layering

**Answer: Cargo has sophisticated hierarchical config, with closest-to-CWD taking precedence.**

### Configuration Sources (in precedence order, highest to lowest):
1. **Command-line flags**
2. **Environment variables** (e.g., `CARGO_FOO_BAR`)
3. **`.cargo/config.toml`** - searched hierarchically:
   - `./project/.cargo/config.toml` (project-specific)
   - `../parent/.cargo/config.toml` (parent directories)
   - `~/.cargo/config.toml` (user global)
4. **`/etc/cargo/config.toml`** (system-wide, Unix only)

From the docs:
> "The value defined closest to the current directory takes precedence, with `$HOME/.cargo/config.toml` taking the lowest precedence."

### Key Behaviors:
- **Merging**: Most values merge/override by key
- **Arrays**: Some array values replace, some merge (context-dependent)
- **`[patch]`**: Patches in config files override those in `Cargo.toml`

**Comparison to sk**: Cargo DOES inherit from global to local (layered). sk's design explicitly does NOT inherit between global and local scope.

## 4. Cargo's Equivalent of `--global` Flag

**Answer: `cargo install` is inherently global-scoped.**

### `cargo install` behavior:
- Installs to `$CARGO_HOME/bin/` by default
- Can override with `--root <path>` flag
- `--root` changes installation prefix (binaries go to `<root>/bin/`)

### Installation root precedence:
1. `--root` option
2. `CARGO_INSTALL_ROOT` environment variable
3. `install.root` config value
4. `CARGO_HOME` environment variable
5. `$HOME/.cargo` (default)

### Special case for `--path`:
When using `cargo install --path ./local-crate`:
- Local configuration discovery is used (starting at `./local-crate/.cargo/config.toml`)
- But installation still goes to global location unless `--root` specified

**There's no explicit `--global` flag** because `cargo install` is already global by default. The `--root` flag is the inverse.

## 5. Installation Locations: Local vs Global

### Global (default):
```
$CARGO_HOME/
├── bin/           # Installed binaries (cargo install)
├── config.toml    # Global configuration
├── registry/      # Downloaded crate sources (cached)
│   ├── cache/     # Compressed .crate files
│   ├── index/     # Registry index
│   └── src/       # Extracted sources
└── git/           # Git checkouts of dependencies
```

### Local (project):
```
./project/
├── Cargo.toml     # Project manifest
├── Cargo.lock     # Dependency lockfile
├── .cargo/
│   └── config.toml  # Project-specific config
└── target/        # Build artifacts (not installed binaries)
    ├── debug/
    └── release/
```

**Key insight**: Cargo doesn't install dependencies locally - it caches sources globally and compiles locally. `cargo install` is for tools, not dependencies.

## 6. Workspaces and Nested Projects

### Workspaces:
```toml
# Root Cargo.toml
[workspace]
members = ["crate-a", "crate-b", "crates/*"]
resolver = "3"

# Optional: shared dependencies
[workspace.dependencies]
serde = "1.0"
```

### Virtual Manifests:
- A `Cargo.toml` with `[workspace]` but NO `[package]` section
- Used when there's no "primary" package
- All member crates are equal

### Nested Project Discovery:
> "When inside a subdirectory within the workspace, Cargo will automatically search the parent directories for a `Cargo.toml` file with a `[workspace]` definition."

### Member Override:
Members can use `package.workspace = "../path"` to explicitly point to workspace root (useful when member is not a subdirectory).

**Key pattern**: Cargo's workspace is orthogonal to git repos. A workspace can contain multiple git repos via path dependencies, or a single repo can contain multiple independent Cargo projects.

## 7. Lessons for sk

### Patterns to Adopt:

1. **Clear separation of concerns**:
   - Dependencies vs installed tools
   - sk could benefit from this: "skills" as project dependencies vs "globally installed skills"

2. **Hierarchical config with clear precedence**:
   - Cargo's layered `.cargo/config.toml` is powerful
   - However, sk explicitly chooses NO inheritance - simpler mental model

3. **Explicit scope override**:
   - `--root` for cargo install
   - `--global` for sk (similar pattern, different semantics)

4. **Shared cache, local builds**:
   - Cargo caches sources globally but builds locally
   - sk could cache skill sources centrally while maintaining per-project manifests

### Patterns to Avoid:

1. **Unbounded upward search**:
   - Cargo searches upward indefinitely for `Cargo.toml`
   - sk bounds search at git root - more predictable behavior in monorepos

2. **Complex inheritance rules**:
   - Cargo's merge/override semantics are powerful but complex
   - sk's "no inheritance" is simpler: global and local are completely separate namespaces

3. **Implicit workspace membership**:
   - Cargo's workspace discovery can be surprising
   - sk's explicit git boundary is clearer

## Summary Table

| Aspect | Cargo | sk Design |
|--------|-------|-----------|
| Project boundary | `Cargo.toml` upward | Git root |
| Global scope | `~/.cargo/` | `~/.sk/` |
| Inheritance | Layered, merges | None |
| Scope flag | `--root` (opposite) | `--global` |
| Installation | `$CARGO_HOME/bin/` | `~/.{agent}/skills/` |
