/**
 * Filesystem test helpers
 *
 * Utilities for working with temporary directories and fixture packages in tests.
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Creates a temporary directory, runs the callback, and cleans up afterward.
 * The directory is always removed, even if the callback throws.
 *
 * @example
 * await withTempDir(async (dir) => {
 *   await writeFile(join(dir, 'test.txt'), 'hello')
 *   // dir is cleaned up after this
 * })
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "sk-test-"))
	try {
		return await fn(dir)
	} finally {
		await rm(dir, { force: true, recursive: true })
	}
}

/**
 * Check if a file or directory exists.
 */
export async function exists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

/**
 * Check if a path is a directory.
 */
export async function isDirectory(path: string): Promise<boolean> {
	try {
		const stats = await stat(path)
		return stats.isDirectory()
	} catch {
		return false
	}
}

/**
 * Check if a path is a file.
 */
export async function isFile(path: string): Promise<boolean> {
	try {
		const stats = await stat(path)
		return stats.isFile()
	} catch {
		return false
	}
}

/**
 * Skill definition for fixture packages.
 */
export interface FixtureSkill {
	name: string
	content?: string
}

/**
 * Options for setting up a plugin-style fixture package.
 */
export interface FixturePluginOptions {
	/** Plugin name (defaults to directory basename) */
	name?: string
	/** Plugin version (defaults to "1.0.0") */
	version?: string
	/** Skills to include in the package */
	skills?: FixtureSkill[]
	/** Whether to include a marketplace.json file (defaults to false) */
	includeMarketplace?: boolean
	/** Marketplace name (defaults to "dev-marketplace") */
	marketplaceName?: string
}

/**
 * Creates a plugin-style package structure for testing.
 * This creates a `.claude-plugin/plugin.json` and optionally a `marketplace.json`.
 *
 * @example
 * await setupFixturePlugin(join(dir, 'my-plugin'), {
 *   skills: [{ name: 'greeting' }],
 *   includeMarketplace: true, // tests the dual plugin+marketplace case
 * })
 */
export async function setupFixturePlugin(
	pkgDir: string,
	options: FixturePluginOptions = {},
): Promise<void> {
	const {
		name = pkgDir.split("/").pop() ?? "test-plugin",
		version = "1.0.0",
		skills = [],
		includeMarketplace = false,
		marketplaceName = "dev-marketplace",
	} = options

	// Create package and .claude-plugin directories
	const pluginMetaDir = join(pkgDir, ".claude-plugin")
	await mkdir(pluginMetaDir, { recursive: true })

	// Create plugin.json
	const pluginJson = {
		description: `Test plugin: ${name}`,
		name,
		version,
	}
	await writeFile(
		join(pluginMetaDir, "plugin.json"),
		JSON.stringify(pluginJson, null, 2),
	)

	// Optionally create marketplace.json (for testing dual plugin+marketplace packages)
	if (includeMarketplace) {
		const marketplaceJson = {
			name: marketplaceName,
			plugins: [{ name, source: "./", version }],
		}
		await writeFile(
			join(pluginMetaDir, "marketplace.json"),
			JSON.stringify(marketplaceJson, null, 2),
		)
	}

	// Create skills directory with skill subdirectories
	if (skills.length > 0) {
		const skillsPath = join(pkgDir, "skills")
		await mkdir(skillsPath, { recursive: true })

		for (const skill of skills) {
			const skillDirPath = join(skillsPath, skill.name)
			await mkdir(skillDirPath, { recursive: true })

			const skillContent = `---
name: ${skill.name}
---

${skill.content ?? `# ${skill.name}\n\nA test skill.`}
`
			await writeFile(join(skillDirPath, "SKILL.md"), skillContent)
		}
	}
}

/**
 * Creates a marketplace-only fixture (no plugin.json).
 *
 * @example
 * await setupFixtureMarketplace(join(dir, 'my-marketplace'), {
 *   plugins: [{ name: 'foo', source: 'github:org/repo' }],
 * })
 */
export interface FixtureMarketplaceOptions {
	/** Marketplace name */
	name?: string
	/** Plugins listed in the marketplace */
	plugins?: Array<{ name: string; source: string }>
}

export async function setupFixtureMarketplace(
	pkgDir: string,
	options: FixtureMarketplaceOptions = {},
): Promise<void> {
	const { name = "test-marketplace", plugins = [] } = options

	const pluginMetaDir = join(pkgDir, ".claude-plugin")
	await mkdir(pluginMetaDir, { recursive: true })

	const marketplaceJson = {
		name,
		plugins: plugins.map((p) => ({ name: p.name, source: p.source })),
	}
	await writeFile(
		join(pluginMetaDir, "marketplace.json"),
		JSON.stringify(marketplaceJson, null, 2),
	)
}

/**
 * Options for setting up a fixture package.
 */
export interface FixturePackageOptions {
	/** Package name (defaults to directory basename) */
	name?: string
	/** Package version (defaults to "1.0.0") */
	version?: string
	/** Skills to include in the package */
	skills?: FixtureSkill[]
	/** Skills directory name (defaults to "skills") */
	skillsDir?: string
	/** Whether to create an agents.toml (defaults to true) */
	createManifest?: boolean
}

/**
 * Creates a fake package structure for testing.
 *
 * @example
 * await setupFixturePackage(join(dir, 'my-pkg'), {
 *   skills: [{ name: 'greeting', content: '# Hello\nA greeting skill' }]
 * })
 */
export async function setupFixturePackage(
	pkgDir: string,
	options: FixturePackageOptions = {},
): Promise<void> {
	const {
		name = pkgDir.split("/").pop() ?? "test-pkg",
		version = "1.0.0",
		skills = [],
		skillsDir = "skills",
		createManifest = true,
	} = options

	// Create package directory
	await mkdir(pkgDir, { recursive: true })

	// Create manifest
	if (createManifest) {
		const manifest = `[package]
name = "${name}"
version = "${version}"

[exports.auto_discover]
skills = "${skillsDir}"
`
		await writeFile(join(pkgDir, "agents.toml"), manifest)
	}

	// Create skills directory with skill subdirectories
	// Each skill is a directory containing a SKILL.md file
	if (skills.length > 0) {
		const skillsPath = join(pkgDir, skillsDir)
		await mkdir(skillsPath, { recursive: true })

		for (const skill of skills) {
			const skillDirName = skill.name.replace(/\.md$/, "")
			const skillDirPath = join(skillsPath, skillDirName)
			await mkdir(skillDirPath, { recursive: true })

			// SKILL.md requires YAML frontmatter with name field
			const skillContent = `---
name: ${skillDirName}
---

${skill.content}
`
			await writeFile(join(skillDirPath, "SKILL.md"), skillContent)
		}
	}
}
