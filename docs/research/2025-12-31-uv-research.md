# uv Package Manager Research

> Research conducted 2025-12-31 comparing uv (Python/Astral) to sk design

## 1. How does uv determine project boundaries?

**uv uses `pyproject.toml` as the project boundary marker, NOT git.**

Key discovery mechanisms:
- uv walks up the directory tree from the current working directory looking for `pyproject.toml` or `uv.toml` files
- The first `pyproject.toml` with a `[project]` table (or `[tool.uv]` table) becomes the project root
- For workspaces, the workspace root `pyproject.toml` with `[tool.uv.workspace]` defines the boundary
- Configuration files (`pyproject.toml`, `uv.toml`, `.python-version`) are discovered by "walking up the directory tree from the project root"

**Contrast with sk spec:**
- sk uses git boundary (git root) to define project scope
- uv does NOT use git boundaries - it purely relies on `pyproject.toml` discovery

## 2. Does uv have a concept of "global" vs "project" dependencies?

**Yes, uv has a distinct separation between project-level and user-level (global) packages:**

### Project dependencies:
- Defined in `pyproject.toml` under `[project.dependencies]` or `[dependency-groups]`
- Installed into project-local `.venv/` directory
- Managed via `uv add`, `uv sync`, `uv lock`

### Global/User-level tools:
- Installed via `uv tool install`
- Stored in `~/.local/share/uv/tools/` (on Unix)
- Executables linked to `~/.local/bin/`
- These are CLI tools meant to be available system-wide, isolated from any project

**Important distinction:**
- uv does NOT have "global dependencies" in the pip sense
- It has "tools" which are self-contained CLI applications with their own isolated virtual environments
- Tools are completely separate from project dependencies

## 3. How does uv handle inheritance/layering of config files?

**uv has a 3-tier configuration hierarchy with merging:**

1. **Project-level**: `pyproject.toml` or `uv.toml` in project directory (highest priority)
2. **User-level**: `~/.config/uv/uv.toml` (medium priority)
3. **System-level**: `/etc/uv/uv.toml` (lowest priority)

**Merging behavior:**
- Scalar values (strings, numbers, booleans): project overrides user overrides system
- Arrays: concatenated, with project-level appearing first
- `uv.toml` takes precedence over `pyproject.toml` if both exist in same directory

**Key note for tools:**
> "For `tool` commands, which operate at the user level, local configuration files will be ignored. Instead, uv will exclusively read from user-level configuration (e.g., `~/.config/uv/uv.toml`) and system-level configuration (e.g., `/etc/uv/uv.toml`)."

**Contrast with sk spec:**
- sk has NO inheritance from global to local - they're completely separate
- uv DOES merge/inherit settings across tiers

## 4. What is uv's equivalent of `--global` flag?

**uv does NOT have a `--global` flag.**

Instead, uv uses separate command namespaces:
- `uv add`, `uv sync`, `uv run` - project-level operations
- `uv tool install`, `uv tool run` (or `uvx`) - user-level tool operations

The command itself determines the scope, not a flag. This is a design choice: tools and project dependencies are conceptually different things with different commands.

## 5. Where does uv install packages locally vs globally?

### Local (project) installation:
- Virtual environment: `.venv/` in project root (next to `pyproject.toml`)
- Can override with `UV_PROJECT_ENVIRONMENT` env var
- Lockfile: `uv.lock` in project root

### Global (tools) installation:
- Tool virtual environments: `~/.local/share/uv/tools/<tool-name>/`
- Tool executables: `~/.local/bin/` (symlinked on Unix, copied on Windows)
- Cache: `~/.cache/uv/`
- Python installations: `~/.local/share/uv/python/`

## 6. How does uv handle subdirectories of a project?

**uv walks up the directory tree to find the project root:**

From the CLI documentation:
> "All `pyproject.toml`, `uv.toml`, and `.python-version` files will be discovered by walking up the directory tree from the project root, as will the project's virtual environment (`.venv`)."

Key behaviors:
- Running `uv` commands from a subdirectory will find the project root automatically
- The `--project` flag can explicitly specify which directory to use as project root
- The `--directory` flag changes the working directory entirely
- Workspace members are discovered but configuration is read from workspace root only

**Workspace behavior:**
- In workspaces, configuration is shared across all members
- Settings like `constraint-dependencies`, `override-dependencies`, `exclude-dependencies` are ONLY read from workspace root, ignored in workspace members

## 7. Lessons for sk

### Patterns to adopt:

1. **Directory tree walking for discovery** - uv walks up to find `pyproject.toml`. sk could walk up to git root similarly.

2. **Clear command separation for scope** - uv uses `uv add` vs `uv tool install`. sk could consider if `--global` flag is the right approach vs. separate commands.

3. **No implicit global installation** - uv never installs to global by accident. Every command has a clear scope.

4. **Workspace configuration at root only** - For workspace-level settings, uv only reads from workspace root. Prevents confusion about which config applies.

5. **Environment variable overrides** - uv supports `UV_PROJECT_ENVIRONMENT`, `UV_TOOL_DIR`, etc. for CI/Docker scenarios.

### Patterns to potentially avoid:

1. **Config inheritance/merging** - uv merges user and project config. sk's spec explicitly says "no inheritance from global to local" which is simpler and more predictable.

2. **pyproject.toml as boundary** - uv uses `pyproject.toml` which can lead to ambiguity in monorepos. sk's git boundary is clearer.

3. **Multiple config formats** - uv supports both `pyproject.toml` and `uv.toml`. sk could keep it simpler with one format.

## Summary Table

| Aspect | uv | sk Design |
|--------|-----|-----------|
| Project boundary | `pyproject.toml` discovery | Git root |
| Global scope | User config dirs (`~/.config/uv/`) | `~/.sk/agents.toml` |
| Local install location | `.venv/` (project root) | `CWD/.{agent}/skills/` |
| Global install location | `~/.local/share/uv/tools/` | `~/.{agent}/skills/` |
| Config inheritance | Yes (merge project + user + system) | No (completely separate) |
| Scope switching | Different commands | `--global` flag |
| Subdirectory handling | Walk up to find `pyproject.toml` | Walk up to git root |
