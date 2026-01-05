/**
 * Shared constants for skill/plugin detection across packages.
 *
 * These are the canonical filenames and directory names used to identify
 * different package types in the skills-supply ecosystem.
 */

/** Package manifest file - defines a skills package with dependencies and exports */
export const MANIFEST_FILENAME = "agents.toml"

/** Skill definition file - markdown with YAML frontmatter */
export const SKILL_FILENAME = "SKILL.md"

/** Claude plugin directory */
export const PLUGIN_DIR = ".claude-plugin"

/** Plugin manifest file inside PLUGIN_DIR */
export const PLUGIN_FILENAME = "plugin.json"

/** Marketplace definition file inside PLUGIN_DIR */
export const MARKETPLACE_FILENAME = "marketplace.json"

/** Default skills subdirectory in plugin packages */
export const PLUGIN_SKILLS_DIR = "skills"

/** Global sk configuration directory (relative to home) */
export const SK_GLOBAL_DIR = ".sk"

/**
 * Directories to ignore during repository scanning.
 *
 * These are build artifacts, dependencies, or internal directories
 * that should never contain packageable skills.
 */
export const IGNORED_DIRS = new Set([
	".git",
	".next",
	".turbo",
	".vscode",
	".idea",
	".cache",
	"__pycache__",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"vendor",
	PLUGIN_DIR, // Skip plugin internals when scanning
])
