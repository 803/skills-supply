import { realpathSync } from "node:fs"
import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { AbsolutePath } from "@skills-supply/core"
import { MANIFEST_FILENAME, SK_GLOBAL_DIR } from "@skills-supply/core"
import type { ManifestDiscoveryError, ManifestDiscoveryResult } from "@/manifest/types"

type FileExistsResult =
	| { ok: true; value: boolean }
	| { ok: false; error: ManifestDiscoveryError }

type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> }
	| { ok: false; error: ManifestDiscoveryError }

/**
 * Walk up from startDir to find the closest agents.toml.
 * Stops at the home directory boundary (if inside home) or filesystem root.
 */
export async function findProjectRoot(
	startDir: string,
): Promise<ManifestDiscoveryResult> {
	const absoluteStart = path.resolve(startDir) as AbsolutePath
	const startStat = await safeStat(absoluteStart)
	if (!startStat.ok) {
		return startStat
	}

	if (!startStat.value.isDirectory()) {
		return {
			error: {
				field: "start",
				message: "Manifest discovery start path must be a directory.",
				path: absoluteStart,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const homeDir = path.resolve(homedir()) as AbsolutePath
	const rootDir = path.parse(absoluteStart).root
	const stopDir = isWithinHome(absoluteStart, homeDir) ? homeDir : rootDir

	let current = absoluteStart as string
	while (true) {
		const manifestPath = path.join(current, MANIFEST_FILENAME) as AbsolutePath
		const existsResult = await fileExists(manifestPath, current)
		if (!existsResult.ok) {
			return existsResult
		}

		if (existsResult.value) {
			return { ok: true, value: current as AbsolutePath }
		}

		if (current === stopDir) {
			break
		}

		const parent = path.dirname(current)
		if (parent === current) {
			break
		}

		current = parent
	}

	return { ok: true, value: null }
}

/**
 * Find the global manifest root directory (~/.sk).
 * Returns the directory path if ~/.sk/agents.toml exists, null otherwise.
 */
export async function findGlobalRoot(): Promise<ManifestDiscoveryResult> {
	const homeDir = path.resolve(homedir()) as AbsolutePath
	const globalRoot = path.join(homeDir, SK_GLOBAL_DIR) as AbsolutePath
	const manifestPath = path.join(globalRoot, MANIFEST_FILENAME) as AbsolutePath
	const existsResult = await fileExists(manifestPath, homeDir)
	if (!existsResult.ok) {
		return existsResult
	}

	if (!existsResult.value) {
		return { ok: true, value: null }
	}

	return { ok: true, value: globalRoot }
}

/**
 * Check if candidate path is within homeDir, handling symlinks.
 * Both paths are resolved to their canonical form before comparison.
 */
function isWithinHome(candidate: string, homeDir: string): boolean {
	let realCandidate = candidate
	let realHome = homeDir

	try {
		realCandidate = realpathSync(candidate)
		realHome = realpathSync(homeDir)
	} catch {
		// Fall back to original paths if resolution fails
	}

	if (realCandidate === realHome) {
		return true
	}

	const relative = path.relative(realHome, realCandidate)
	return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function fileExists(
	filePath: AbsolutePath,
	currentDir: string,
): Promise<FileExistsResult> {
	try {
		const stats = await stat(filePath)
		if (!stats.isFile()) {
			return {
				error: {
					message: `${MANIFEST_FILENAME} exists but is not a file: ${filePath}`,
					operation: "stat",
					path: filePath,
					type: "io",
				},
				ok: false,
			}
		}

		return { ok: true, value: true }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: false }
		}

		if (isPermissionError(error)) {
			return {
				error: {
					message: "Cannot access parent directory. Check permissions.",
					operation: "stat",
					path: currentDir as AbsolutePath,
					rawError: error instanceof Error ? error : undefined,
					type: "io",
				},
				ok: false,
			}
		}

		return {
			error: {
				message: `Unable to access ${filePath}.`,
				operation: "stat",
				path: filePath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function safeStat(targetPath: AbsolutePath): Promise<StatResult> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return {
				error: {
					field: "start",
					message: "Start path does not exist.",
					path: targetPath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		return {
			error: {
				message: `Unable to access ${targetPath}.`,
				operation: "stat",
				path: targetPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}

function isPermissionError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code !== undefined &&
		["EACCES", "EPERM"].includes((error as { code?: string }).code ?? "")
	)
}
