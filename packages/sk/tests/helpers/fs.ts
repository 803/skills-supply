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
	content: string
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
	/** Whether to create a package.toml (defaults to true) */
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
		await writeFile(join(pkgDir, "package.toml"), manifest)
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
