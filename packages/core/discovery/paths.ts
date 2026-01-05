import type { Dirent } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { SKILL_FILENAME } from "@/constants"
import type { AbsolutePath } from "@/types/branded"
import { coerceAbsolutePath } from "@/types/coerce"
import type { Result } from "@/types/error"

export async function discoverSkillPathsForPlugin(
	skillsDir: AbsolutePath,
): Promise<Result<AbsolutePath[]>> {
	const stats = await safeStat(skillsDir)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return {
			error: {
				message: `Skills directory not found: ${skillsDir}`,
				path: skillsDir,
				target: "skills_dir",
				type: "not_found",
			},
			ok: false,
		}
	}

	if (!stats.value.isDirectory()) {
		return {
			error: {
				message: `Expected directory at ${skillsDir}.`,
				path: skillsDir,
				type: "detection",
			},
			ok: false,
		}
	}

	return discoverSkillDirs(skillsDir, skillsDir)
}

export async function discoverSkillPathsForSubdir(
	rootDir: AbsolutePath,
): Promise<Result<AbsolutePath[]>> {
	const stats = await safeStat(rootDir)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return {
			error: {
				message: `Root directory not found: ${rootDir}`,
				path: rootDir,
				target: "root_dir",
				type: "not_found",
			},
			ok: false,
		}
	}

	if (!stats.value.isDirectory()) {
		return {
			error: {
				message: `Expected directory at ${rootDir}.`,
				path: rootDir,
				type: "detection",
			},
			ok: false,
		}
	}

	return discoverSkillDirs(rootDir, rootDir)
}

async function discoverSkillDirs(
	rootPath: AbsolutePath,
	errorPath: AbsolutePath,
): Promise<Result<AbsolutePath[]>> {
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
			return {
				error: {
					message: `Invalid skill directory entry "${entry.name}" under ${rootPath}.`,
					path: errorPath,
					type: "detection",
				},
				ok: false,
			}
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
	errorPath: AbsolutePath,
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
				path: errorPath,
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
			coerceAbsolutePath(targetPath, "/") ?? (targetPath as AbsolutePath)
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
