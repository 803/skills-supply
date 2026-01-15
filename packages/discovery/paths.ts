import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Cross-runtime path resolution for discovery package.
 *
 * Works across:
 * - Node.js (ESM)
 * - Bun runtime
 * - Bun compiled binaries
 * - tsx/ts-node
 *
 * When compiled with Bun, import.meta.url contains a virtual $bunfs path
 * that doesn't map to real filesystem locations. In that case, we resolve
 * relative to process.execPath (the binary location).
 */

const PACKAGE_NAME = "@skills-supply/discovery"
const DEBUG = process.env.DEBUG_PATHS === "1"

// This file is at packages/discovery/paths.ts
const THIS_FILE_URL = import.meta.url
const IS_BUN_COMPILED = THIS_FILE_URL.includes("$bunfs")

let _discoveryDir: string | null = null
let _loggedInit = false

function log(message: string): void {
	if (DEBUG) {
		console.log(`[paths] ${message}`)
	}
}

/**
 * Find the discovery package root by walking up from a starting directory
 * until we find a package.json with the correct name.
 */
function findPackageRoot(startDir: string): string | null {
	let currentDir = startDir

	// Walk up to 10 levels (should be plenty)
	for (let i = 0; i < 10; i++) {
		const pkgPath = path.join(currentDir, "package.json")

		if (fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
				if (pkg.name === PACKAGE_NAME) {
					return currentDir
				}
			} catch {
				// Invalid JSON, keep searching
			}
		}

		const parentDir = path.dirname(currentDir)
		if (parentDir === currentDir) {
			// Reached root
			break
		}
		currentDir = parentDir
	}

	return null
}

/**
 * Get the root directory of the discovery package.
 *
 * Handles three scenarios:
 * 1. Development (bun run, tsx, node with source): use this file's directory
 * 2. Bun compiled binary: use process.execPath parent (bin/ -> package root)
 * 3. Bundled (dist/): walk up to find package.json with correct name
 */
export function getDiscoveryDir(metaUrl?: string): string {
	if (_discoveryDir !== null) {
		return _discoveryDir
	}

	const isBunCompiled = IS_BUN_COMPILED || (metaUrl?.includes("$bunfs") ?? false)

	if (!_loggedInit) {
		_loggedInit = true
		log(`import.meta.url = ${THIS_FILE_URL}`)
		log(`IS_BUN_COMPILED = ${IS_BUN_COMPILED}`)
		log(`isBunCompiled = ${isBunCompiled}`)
	}

	if (isBunCompiled) {
		// Bun compiled binary: process.execPath is bin/discovery
		// Discovery dir is parent of bin/
		const binaryPath = path.resolve(process.execPath)
		const binaryDir = path.dirname(binaryPath)
		_discoveryDir = path.resolve(binaryDir, "..")
		log(`[bun-compiled] execPath = ${binaryPath}`)
		log(`[bun-compiled] resolved = ${_discoveryDir}`)
	} else {
		// For both unbundled and bundled node: walk up to find package root
		// This works because:
		// - Unbundled: paths.ts is at packages/discovery/paths.ts
		// - Bundled: dist/cli.js is at packages/discovery/dist/cli.js
		const startDir = path.dirname(fileURLToPath(THIS_FILE_URL))
		log(`[walk-up] startDir = ${startDir}`)
		const found = findPackageRoot(startDir)

		if (found) {
			_discoveryDir = found
			log(`[walk-up] found package root = ${found}`)
		} else {
			// Fallback: assume we're in the package root or its subdirectory
			// Use cwd as last resort
			log(`[walk-up] not found from startDir, trying cwd = ${process.cwd()}`)
			_discoveryDir = findPackageRoot(process.cwd()) ?? process.cwd()
			log(`[walk-up] fallback resolved = ${_discoveryDir}`)
		}
	}

	return _discoveryDir
}

/**
 * Resolve a path relative to the discovery package root.
 *
 * @param segments - Path segments to join
 * @returns Absolute path
 *
 * @example
 * const statePath = resolveDiscoveryPath("reddit-state.json")
 * // => "/path/to/packages/discovery/reddit-state.json"
 *
 * @example
 * // Nested path
 * const subredditsPath = resolveDiscoveryPath("reddit", "subreddits.json")
 * // => "/path/to/packages/discovery/reddit/subreddits.json"
 */
export function resolveDiscoveryPath(...segments: string[]): string {
	const baseDir = getDiscoveryDir()
	const resolved = path.resolve(baseDir, ...segments)
	log(`resolveDiscoveryPath(${segments.join(", ")}) => ${resolved}`)
	return resolved
}

/**
 * Get the directory containing the calling module.
 *
 * This is a lower-level utility for cases where you need
 * paths relative to the calling module, not the discovery root.
 *
 * @param metaUrl - Pass import.meta.url from the calling module
 * @returns Directory containing the calling module
 */
export function getModuleDir(metaUrl: string): string {
	if (metaUrl.includes("$bunfs")) {
		// Compiled binary: best we can do is binary's parent
		const binaryPath = path.resolve(process.execPath)
		const binaryDir = path.dirname(binaryPath)
		return path.resolve(binaryDir, "..")
	}

	return path.dirname(fileURLToPath(metaUrl))
}
