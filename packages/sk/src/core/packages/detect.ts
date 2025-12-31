import type { Dirent } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import type {
	CanonicalPackage,
	PackageDetectionError,
	PackageDetectionResult,
} from "@/src/core/packages/types"
import type { AbsolutePath } from "@/src/core/types/branded"
import { coerceAbsolutePath } from "@/src/core/types/coerce"

const MANIFEST_FILENAME = "package.toml"
const SKILL_FILENAME = "SKILL.md"
const PLUGIN_DIR = ".claude-plugin"
const PLUGIN_FILENAME = "plugin.json"
const PLUGIN_SKILLS_DIR = "skills"

type ExistsResult =
	| { ok: true; value: boolean }
	| { ok: false; error: PackageDetectionError }
type ReadDirResult =
	| { ok: true; value: Dirent[] }
	| { ok: false; error: PackageDetectionError }
type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> | null }
	| { ok: false; error: PackageDetectionError }
type SkillPathsResult =
	| { ok: true; value: AbsolutePath[] }
	| { ok: false; error: PackageDetectionError }

/**
 * Detect the type of package at a given path.
 * Returns DetectedPackage with skillPaths computed.
 */
export async function detectPackageType(
	canonical: CanonicalPackage,
	packagePath: AbsolutePath,
): Promise<PackageDetectionResult> {
	const rootStat = await safeStat(packagePath, packagePath)
	if (!rootStat.ok) {
		return rootStat
	}

	if (!rootStat.value) {
		return failure(
			"invalid_package",
			`Package path does not exist: ${packagePath}`,
			packagePath,
		)
	}

	if (!rootStat.value.isDirectory()) {
		return failure(
			"invalid_package",
			`Package path is not a directory: ${packagePath}`,
			packagePath,
		)
	}

	// Check for package.toml (manifest)
	const manifestPath = coerceAbsolutePath(MANIFEST_FILENAME, packagePath)
	if (!manifestPath) {
		return failure(
			"invalid_package",
			`Unable to resolve ${MANIFEST_FILENAME} under ${packagePath}.`,
			packagePath,
		)
	}
	const manifestExists = await fileExists(manifestPath, packagePath)
	if (!manifestExists.ok) {
		return manifestExists
	}

	if (manifestExists.value) {
		// For manifest packages, skill discovery happens during extraction
		// (depends on exports.auto_discover setting in the manifest)
		return {
			ok: true,
			value: {
				canonical,
				detection: { manifestPath, method: "manifest" },
				packagePath,
				skillPaths: [], // Will be populated by extractSkills
			},
		}
	}

	// Check for .claude-plugin directory
	const pluginDir = path.join(packagePath, PLUGIN_DIR)
	const pluginDirExists = await dirExists(pluginDir, packagePath)
	if (!pluginDirExists.ok) {
		return pluginDirExists
	}

	if (pluginDirExists.value) {
		const pluginPath = path.join(pluginDir, PLUGIN_FILENAME)
		const pluginFileExists = await fileExists(pluginPath, packagePath)
		if (!pluginFileExists.ok) {
			return pluginFileExists
		}

		if (!pluginFileExists.value) {
			return failure(
				"invalid_package",
				`Found ${PLUGIN_DIR} without ${PLUGIN_FILENAME}.`,
				packagePath,
			)
		}

		// Discover skills in plugin's skills directory
		const skillsRoot = coerceAbsolutePath(PLUGIN_SKILLS_DIR, packagePath)
		if (!skillsRoot) {
			return failure(
				"invalid_package",
				`Unable to resolve ${PLUGIN_SKILLS_DIR} under ${packagePath}.`,
				packagePath,
			)
		}
		const skillPaths = await discoverSkillPaths(skillsRoot, packagePath)
		if (!skillPaths.ok) {
			// Plugin might not have skills dir - that's okay
			return {
				ok: true,
				value: {
					canonical,
					detection: { method: "plugin" },
					packagePath,
					skillPaths: [],
				},
			}
		}

		return {
			ok: true,
			value: {
				canonical,
				detection: { method: "plugin" },
				packagePath,
				skillPaths: skillPaths.value,
			},
		}
	}

	// Check for subdirectory skills (dirs containing SKILL.md)
	const subdirSkills = await discoverSkillPaths(packagePath, packagePath)
	if (!subdirSkills.ok) {
		return subdirSkills
	}

	if (subdirSkills.value.length > 0) {
		return {
			ok: true,
			value: {
				canonical,
				detection: { method: "subdir" },
				packagePath,
				skillPaths: subdirSkills.value,
			},
		}
	}

	// Check for single SKILL.md in root
	const rootSkillPath = coerceAbsolutePath(SKILL_FILENAME, packagePath)
	if (!rootSkillPath) {
		return failure(
			"invalid_package",
			`Unable to resolve ${SKILL_FILENAME} under ${packagePath}.`,
			packagePath,
		)
	}
	const rootSkillExists = await fileExists(rootSkillPath, packagePath)
	if (!rootSkillExists.ok) {
		return rootSkillExists
	}

	if (rootSkillExists.value) {
		return {
			ok: true,
			value: {
				canonical,
				detection: { method: "single" },
				packagePath,
				skillPaths: [packagePath], // The skill is in the root
			},
		}
	}

	return failure(
		"invalid_package",
		"No package.toml, plugin.json, or SKILL.md found in package.",
		packagePath,
	)
}

/**
 * Discover skill directories (containing SKILL.md) within a root directory.
 */
async function discoverSkillPaths(
	rootPath: AbsolutePath,
	errorPath: AbsolutePath,
): Promise<SkillPathsResult> {
	const entriesResult = await readDirEntries(rootPath, errorPath)
	if (!entriesResult.ok) {
		return entriesResult
	}

	const skillPaths: AbsolutePath[] = []
	for (const entry of entriesResult.value) {
		if (!entry.isDirectory()) {
			continue
		}

		const skillDir = coerceAbsolutePath(String(entry.name), rootPath)
		if (!skillDir) {
			return failure(
				"invalid_package",
				`Invalid skill directory entry "${entry.name}" under ${rootPath}.`,
				rootPath,
			)
		}
		const skillFile = path.join(skillDir, SKILL_FILENAME)
		const skillExists = await fileExists(skillFile, errorPath)
		if (!skillExists.ok) {
			return skillExists
		}

		if (skillExists.value) {
			skillPaths.push(skillDir)
		}
	}

	return { ok: true, value: skillPaths }
}

async function readDirEntries(
	rootPath: AbsolutePath,
	errorPath: AbsolutePath,
): Promise<ReadDirResult> {
	try {
		const entries = await readdir(rootPath, { withFileTypes: true })
		return { ok: true, value: entries }
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${rootPath}.`),
			errorPath,
		)
	}
}

async function fileExists(
	targetPath: string,
	rootPath: AbsolutePath,
): Promise<ExistsResult> {
	const stats = await safeStat(targetPath, rootPath)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: false }
	}

	if (!stats.value.isFile()) {
		return failure("invalid_package", `Expected file at ${targetPath}.`, rootPath)
	}

	return { ok: true, value: true }
}

async function dirExists(
	targetPath: string,
	rootPath: AbsolutePath,
): Promise<ExistsResult> {
	const stats = await safeStat(targetPath, rootPath)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: false }
	}

	if (!stats.value.isDirectory()) {
		return failure(
			"invalid_package",
			`Expected directory at ${targetPath}.`,
			rootPath,
		)
	}

	return { ok: true, value: true }
}

async function safeStat(
	targetPath: string,
	errorPath: AbsolutePath,
): Promise<StatResult> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to access ${targetPath}.`),
			errorPath,
		)
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

function formatErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return `${fallback} ${error.message}`
	}

	return fallback
}

function failure(
	type: PackageDetectionError["type"],
	message: string,
	pathValue: AbsolutePath,
): { ok: false; error: PackageDetectionError } {
	return {
		error: {
			message,
			path: pathValue,
			type,
		},
		ok: false,
	}
}
