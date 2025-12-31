# Mix Package Manager Research

> Research conducted 2025-12-31 comparing Mix (Elixir) to sk design

## 1. How Mix Determines Project Boundaries

**Mix uses `mix.exs` as the sole project marker** - there is no git boundary detection:

- Mix looks for a `mix.exs` file in the **current working directory** only
- It does NOT walk up parent directories to find a project root
- The `MIX_EXS` environment variable can override this: it specifies an explicit path to the `mix.exs` file to use
- If no `mix.exs` exists in CWD and `MIX_EXS` is not set, Mix runs in "no project" mode where many tasks still work with default values

**Key difference from sk's design**: Mix doesn't use git boundaries at all. It's purely file-based (presence of `mix.exs`).

## 2. Global vs Project Dependencies

Mix has a **clear separation** between different installation scopes:

| Scope | Location | Purpose |
|-------|----------|---------|
| **Project deps** | `./deps/` | Regular dependencies defined in `mix.exs` |
| **Archives** | `~/.mix/archives/` | Globally installed Mix tasks (`.ez` files) |
| **Escripts** | `~/.mix/escripts/` | Globally installed executable scripts |
| **Mix home** | `~/.mix/` | Mix's global config, rebar3, caches |

**Key commands**:
- `mix archive.install` - installs archives globally to `~/.mix/archives/`
- `mix escript.install` - installs escripts globally to `~/.mix/escripts/`
- Both support installing from: local path, Git, GitHub, or Hex

**No `--global` flag needed**: The archive/escript install commands are inherently global. There's no project-local install option for these. The distinction is built into the command itself:
- `mix deps.get` = project dependencies
- `mix archive.install` = global installation

## 3. Config Inheritance/Layering

Mix has a **sophisticated config layering system**:

```
config/config.exs          <- Build-time config (always loaded)
   |
   v imports
config/{dev|test|prod}.exs <- Environment-specific (via import_config)
   |
   v at runtime
config/runtime.exs         <- Runtime config (executed when app starts)
```

**Key behaviors**:
- `config/config.exs` is loaded whenever you invoke any `mix` command
- It typically imports environment-specific files via `import_config "#{config_env()}.exs"`
- `config/runtime.exs` runs at application boot time, enabling runtime env vars
- Configs are **deep-merged** - later configs override earlier ones, but nested keywords merge recursively
- **No global config inheritance**: A project's config stands alone. Dependencies' configs are not inherited by parent projects

## 4. Archives/Escripts as "Global Tools"

Mix doesn't have a `--global` flag because the concepts are inherently separate:

- **Archives** (`mix archive.install hex some_archive`):
  - Install as `.ez` files to `~/.mix/archives/`
  - Provide Mix tasks available to all projects
  - Example: Phoenix generator (`phx.new`)

- **Escripts** (`mix escript.install hex some_escript`):
  - Install as executables to `~/.mix/escripts/`
  - Standalone CLI tools
  - Example: `ex_doc`, `credo`

## 5. Installation Locations

| Type | Default Location | Override Env Var |
|------|------------------|------------------|
| Project deps | `./deps/` | `MIX_DEPS_PATH` |
| Build artifacts | `./_build/` | `MIX_BUILD_PATH`, `MIX_BUILD_ROOT` |
| Archives | `~/.mix/archives/` | `MIX_ARCHIVES` |
| Escripts | `~/.mix/escripts/` | (none) |
| Mix home | `~/.mix/` | `MIX_HOME` |
| Install cache | OS cache dir | `MIX_INSTALL_DIR` |

## 6. Umbrella Projects (Monorepo Pattern)

Mix's umbrella projects share configuration across child apps:

```elixir
# In apps/child_app/mix.exs
build_path: "../../_build",
config_path: "../../config/config.exs",
deps_path: "../../deps",
lockfile: "../../mix.lock",
```

**Key characteristics**:
- All children share the same deps directory, lockfile, and config
- Children can depend on each other via `{:sibling, in_umbrella: true}`
- Umbrella root can run commands across all children
- **Not fully decoupled**: They share global state

**Umbrella limitations** (from docs):
- If you need different config or dependency versions per app, umbrella is the wrong choice
- Alternatives: separate repos, `:path` dependencies, private Hex organization

## 7. Subdirectory Resolution

**Mix does NOT walk up to find project root**. Behavior when in a subdirectory:

- Mix requires you to be in the directory containing `mix.exs`
- No automatic project discovery from child directories
- You must either:
  - `cd` to the project root
  - Use `MIX_EXS=/path/to/mix.exs` environment variable
  - Use `Mix.Project.in_project/4` programmatically

**In umbrella projects**: Each child app has its own `mix.exs`, so you can run mix from the child directory. The child's `mix.exs` points back to parent config via explicit paths.

## 8. Lessons for sk

**Patterns to adopt**:

1. **Clear separation of scopes**: Mix has distinct commands/locations for project vs global. No ambiguity.
2. **Environment variables for overrides**: `MIX_HOME`, `MIX_DEPS_PATH`, etc. allow CI/custom setups.
3. **No inheritance between scopes**: Global tools don't inherit from projects or vice versa. Clean separation.
4. **Explicit paths in umbrella**: Child projects explicitly declare their relationship to parent via config paths.

**Patterns to consider differently**:

1. **Mix doesn't use git boundaries**: sk's design to use git root is actually more developer-friendly than Mix's "exact CWD" requirement. This is a good enhancement over Mix.
2. **Mix lacks `--global` flag**: Because the concepts are split into separate commands. sk's unified `install` command with `--global` flag is more ergonomic for a single-purpose tool.
3. **Mix's umbrella pattern is heavy**: Requiring explicit path rewrites in every child `mix.exs` is verbose. sk might want simpler monorepo support.
4. **No parent directory discovery**: Mix's "must be in CWD" behavior is a pain point. sk's "walk up to git root" is an improvement.

## Summary Table

| Aspect | Mix | sk Design |
|--------|-----|-----------|
| Project boundary | `mix.exs` in CWD only | Git root |
| Global scope | `~/.mix/` | `~/.sk/` |
| Inheritance | None across projects | None |
| Scope flag | None (separate commands) | `--global` |
| Installation | `./deps/` local, `~/.mix/` global | `CWD/.{agent}/skills/` local, `~/.{agent}/skills/` global |
| Subdirectory handling | Must be in exact CWD | Walk up to git root |
