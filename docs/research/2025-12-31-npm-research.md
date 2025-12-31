# npm Scope and Config Research

> Research conducted 2025-12-31 comparing npm to sk design

## 1. How does npm determine project boundaries?

**npm's approach:**
- npm **walks up the folder tree from $PWD** checking for either:
  - A `package.json` file, OR
  - A `node_modules` folder
- The first directory containing either is treated as the "effective current directory" (project root)
- If no package root is found, the current folder is used
- This behavior is explicitly noted as **"inspired by and similar to git's .git-folder seeking logic"**

**Key difference from sk design:**
- npm uses `package.json` or `node_modules` as the boundary marker (not git)
- sk uses git root as the project boundary
- npm's approach is purely filesystem-based; sk ties scope to version control boundaries

## 2. Does npm have global vs project dependencies? How does `-g` work?

**npm's approach:**

| Mode | Install Location | Use Case |
|------|------------------|----------|
| **Local (default)** | `./node_modules/` under package root | Dependencies you `require()` |
| **Global (`-g`)** | `{prefix}/lib/node_modules/` (Unix) or `{prefix}/node_modules/` (Windows) | CLI tools to run from command line |

- `prefix` defaults to where Node is installed (`/usr/local` on most Unix systems, `%AppData%\npm` on Windows)
- Global executables are symlinked to `{prefix}/bin` (Unix) or directly to `{prefix}` (Windows)
- Global mode (`-g`) installs packages into the prefix folder instead of the current package root

**The flag:**
- `-g` is shorthand for `--global`
- When `--global` is set to true, npm operates in "global mode"

## 3. How does npm handle inheritance/layering of config files?

**npm's four config file layers (in priority order):**

1. **Per-project**: `/path/to/project/.npmrc` (sibling of `node_modules` and `package.json`)
2. **Per-user**: `~/.npmrc`
3. **Global**: `$PREFIX/etc/npmrc`
4. **Built-in**: `/path/to/npm/npmrc` (npm's own defaults)

**Important inheritance behavior:**
- Config options are **resolved in priority order** - higher priority overrides lower
- A setting in userconfig overrides globalconfig
- **Per-project `.npmrc` is NOT read in global mode** (`npm install -g`)
- Per-project config only applies to the root of the project you're running npm in
- Config does NOT travel with published packages

## 4. What is npm's equivalent of `--global` flag?

**npm flags:**
- `-g` or `--global` - operates in global mode
- `--location=global` - alternative way to specify

**npm config setting:**
```
global=true
```

## 5. Where does npm install packages locally vs globally?

**Local installation:**
- `./node_modules/` under the package root
- Executables: `./node_modules/.bin/`
- Man pages: Not installed locally

**Global installation:**
- Packages: `{prefix}/lib/node_modules/` (Unix) or `{prefix}/node_modules/` (Windows)
- Executables: `{prefix}/bin/` (Unix) or `{prefix}/` (Windows)
- Man pages: `{prefix}/share/man/` (Unix only)

## 6. How does npm handle workspaces and monorepos?

**npm workspaces:**
- Defined in root `package.json` via `"workspaces"` field
- Can be direct paths or globs: `["./packages/*"]`
- Workspace packages must have valid `package.json` files
- Dependencies are symlinked to top-level `node_modules`

**Key workspace behaviors:**
- `npm install` at root links workspace packages
- `--workspace` flag targets specific workspace(s)
- `--workspaces` flag runs in all workspaces
- `--include-workspace-root` includes the root project

## 7. How does npm resolve when you're in a subdirectory without package.json?

**npm's behavior:**
- Walks up the directory tree looking for `package.json` or `node_modules`
- Uses the first match as the package root
- If nothing found, uses current directory

**Example:**
```
/repo
  /packages
    /foo
      package.json  <-- npm will find this
      /src
        /components  <-- If you run npm here, it still uses /repo/packages/foo
```

## 8. Lessons for sk

**ADOPT from npm:**

1. **`-g` / `--global` flag convention** - sk already uses this, good alignment
2. **Separate install locations for local vs global** - sk already does this
3. **Walk-up-the-tree for project discovery** - sk does this with git as terminator
4. **Project config in project root** - `agents.toml` at CWD or git root

**AVOID from npm:**

1. **Layered config inheritance** - npm's 4-layer config system causes debugging pain. sk's "no inheritance between global and local" is cleaner.

2. **Multiple project boundaries in one repo** - npm allows nested package.json files to create sub-projects. This leads to confusion about which node_modules applies. sk's git-root-as-boundary is simpler.

3. **Prefix-based global location** - npm's global location depends on where Node was installed, leading to permission issues and platform inconsistencies. sk's `~/.sk/` and `~/.{agent}/` is more predictable.

4. **Implicit workspace discovery** - npm workspaces require explicit configuration. If sk ever needs sub-project support, explicit is better than magic detection.

5. **Per-project config not read in global mode** - npm's `.npmrc` is ignored with `-g`. sk should be clear about this behavior too if it applies.

## Summary Table

| Aspect | npm | sk Design |
|--------|-----|-----------|
| Project boundary | package.json / node_modules | Git root |
| Boundary detection | Walk up until marker found | CWD to git root |
| Global flag | `-g` / `--global` | `--global` |
| Config inheritance | 4-layer cascade | None (separate scopes) |
| Local install path | `./node_modules/` | `CWD/.{agent}/skills/` |
| Global install path | `{prefix}/lib/node_modules/` | `~/.{agent}/skills/` |
| Global config | `$PREFIX/etc/npmrc` | `~/.sk/agents.toml` |
| Workspaces | Explicit in package.json | Git repo = workspace |
| Subdirectory behavior | Walk to nearest package.json | Walk to git root |
