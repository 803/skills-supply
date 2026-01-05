import type { Dirent } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import {
	MANIFEST_FILENAME,
	MARKETPLACE_FILENAME,
	PLUGIN_DIR,
	PLUGIN_FILENAME,
	PLUGIN_SKILLS_DIR,
	SKILL_FILENAME,
} from "@/constants"
import type { AbsolutePath } from "@/types/branded"
import { coerceAbsolutePath, coerceAbsolutePathDirect } from "@/types/coerce"
import type { DetectedStructure, DetectionTarget } from "@/types/detection"
import type { Result } from "@/types/error"

export async function detectStructure(
	target: DetectionTarget,
): Promise<Result<DetectedStructure[]>> {
	const rootStat = await safeStat(target.packagePath)
	if (!rootStat.ok) {
		return rootStat
	}

	if (!rootStat.value) {
		return {
			error: {
				message: `Package path does not exist: ${target.packagePath}`,
				path: target.packagePath,
				type: "detection",
			},
			ok: false,
		}
	}

	if (!rootStat.value.isDirectory()) {
		return {
			error: {
				message: `Package path is not a directory: ${target.packagePath}`,
				path: target.packagePath,
				type: "detection",
			},
			ok: false,
		}
	}

	const structures: DetectedStructure[] = []

	const manifestPath = coerceAbsolutePath(MANIFEST_FILENAME, target.packagePath)
	if (!manifestPath) {
		return {
			error: {
				message: `Unable to resolve ${MANIFEST_FILENAME} under ${target.packagePath}.`,
				path: target.packagePath,
				type: "detection",
			},
			ok: false,
		}
	}
	const manifestExists = await fileExists(manifestPath, target.packagePath)
	if (!manifestExists.ok) {
		return manifestExists
	}
	if (manifestExists.value) {
		structures.push({ manifestPath, method: "manifest" })
	}

	const pluginDir = path.join(target.packagePath, PLUGIN_DIR)
	const pluginDirExists = await dirExists(pluginDir, target.packagePath)
	if (!pluginDirExists.ok) {
		return pluginDirExists
	}

	if (pluginDirExists.value) {
		const pluginJsonPath = path.join(pluginDir, PLUGIN_FILENAME)
		const pluginJsonExists = await fileExists(pluginJsonPath, target.packagePath)
		if (!pluginJsonExists.ok) {
			return pluginJsonExists
		}

		if (pluginJsonExists.value) {
			const skillsDirPath = coerceAbsolutePath(
				PLUGIN_SKILLS_DIR,
				target.packagePath,
			)
			if (!skillsDirPath) {
				return {
					error: {
						message: `Unable to resolve ${PLUGIN_SKILLS_DIR} under ${target.packagePath}.`,
						path: target.packagePath,
						type: "detection",
					},
					ok: false,
				}
			}

			const skillsDirExists = await dirExists(skillsDirPath, target.packagePath)
			if (!skillsDirExists.ok) {
				return skillsDirExists
			}

			const resolvedPluginPath = coerceAbsolutePathDirect(pluginJsonPath)
			if (!resolvedPluginPath) {
				return {
					error: {
						message: `Unable to resolve ${PLUGIN_FILENAME} under ${target.packagePath}.`,
						path: target.packagePath,
						type: "detection",
					},
					ok: false,
				}
			}

			structures.push({
				method: "plugin",
				pluginJsonPath: resolvedPluginPath,
				skillsDir: skillsDirExists.value ? skillsDirPath : null,
			})
		}

		const marketplaceJsonPath = path.join(pluginDir, MARKETPLACE_FILENAME)
		const marketplaceExists = await fileExists(
			marketplaceJsonPath,
			target.packagePath,
		)
		if (!marketplaceExists.ok) {
			return marketplaceExists
		}

		if (marketplaceExists.value) {
			const resolved = coerceAbsolutePathDirect(marketplaceJsonPath)
			if (!resolved) {
				return {
					error: {
						message: `Unable to resolve ${MARKETPLACE_FILENAME} under ${target.packagePath}.`,
						path: target.packagePath,
						type: "detection",
					},
					ok: false,
				}
			}
			structures.push({
				marketplaceJsonPath: resolved,
				method: "marketplace",
			})
		}

		if (!pluginJsonExists.value && !marketplaceExists.value) {
			return {
				error: {
					message: `Found ${PLUGIN_DIR} without ${PLUGIN_FILENAME} or ${MARKETPLACE_FILENAME}.`,
					path: target.packagePath,
					type: "detection",
				},
				ok: false,
			}
		}
	}

	const hasSubdirSkills = await hasSkillSubdirectories(target.packagePath)
	if (!hasSubdirSkills.ok) {
		return hasSubdirSkills
	}
	if (hasSubdirSkills.value) {
		structures.push({ method: "subdir", rootDir: target.packagePath })
	}

	const rootSkillPath = coerceAbsolutePath(SKILL_FILENAME, target.packagePath)
	if (!rootSkillPath) {
		return {
			error: {
				message: `Unable to resolve ${SKILL_FILENAME} under ${target.packagePath}.`,
				path: target.packagePath,
				type: "detection",
			},
			ok: false,
		}
	}
	const rootSkillExists = await fileExists(rootSkillPath, target.packagePath)
	if (!rootSkillExists.ok) {
		return rootSkillExists
	}
	if (rootSkillExists.value) {
		structures.push({ method: "single", skillPath: target.packagePath })
	}

	return { ok: true, value: structures }
}

async function hasSkillSubdirectories(rootPath: AbsolutePath): Promise<Result<boolean>> {
	const entriesResult = await readDirEntries(rootPath, rootPath)
	if (!entriesResult.ok) {
		return entriesResult
	}

	for (const entry of entriesResult.value) {
		if (!entry.isDirectory()) {
			continue
		}

		const skillDir = coerceAbsolutePath(String(entry.name), rootPath)
		if (!skillDir) {
			return {
				error: {
					message: `Invalid skill directory entry "${entry.name}" under ${rootPath}.`,
					path: rootPath,
					type: "detection",
				},
				ok: false,
			}
		}
		const skillFile = path.join(skillDir, SKILL_FILENAME)
		const skillExists = await fileExists(skillFile, rootPath)
		if (!skillExists.ok) {
			return skillExists
		}

		if (skillExists.value) {
			return { ok: true, value: true }
		}
	}

	return { ok: true, value: false }
}

async function readDirEntries(
	rootPath: AbsolutePath,
	errorPath: AbsolutePath,
): Promise<Result<Dirent[]>> {
	try {
		const entries = await readdir(rootPath, { withFileTypes: true })
		return { ok: true, value: entries }
	} catch (error) {
		return {
			error: {
				message: `Unable to read ${rootPath}.`,
				operation: "readdir",
				path: errorPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function fileExists(
	targetPath: string,
	rootPath: AbsolutePath,
): Promise<Result<boolean>> {
	const stats = await safeStat(targetPath)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: false }
	}

	if (!stats.value.isFile()) {
		return {
			error: {
				message: `Expected file at ${targetPath}.`,
				path: rootPath,
				type: "detection",
			},
			ok: false,
		}
	}

	return { ok: true, value: true }
}

async function dirExists(
	targetPath: string,
	rootPath: AbsolutePath,
): Promise<Result<boolean>> {
	const stats = await safeStat(targetPath)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: false }
	}

	if (!stats.value.isDirectory()) {
		return {
			error: {
				message: `Expected directory at ${targetPath}.`,
				path: rootPath,
				type: "detection",
			},
			ok: false,
		}
	}

	return { ok: true, value: true }
}

async function safeStat(
	targetPath: string,
): Promise<Result<Awaited<ReturnType<typeof stat>> | null>> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		const pathValue =
			coerceAbsolutePathDirect(targetPath) ?? (targetPath as AbsolutePath)
		return {
			error: {
				message: `Unable to access ${targetPath}.`,
				operation: "stat",
				path: pathValue,
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
