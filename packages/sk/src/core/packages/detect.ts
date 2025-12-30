import type { Dirent } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import type { PackageDetectionError, PackageDetectionResult } from "@/core/packages/types"

const MANIFEST_FILENAME = "package.toml"
const SKILL_FILENAME = "SKILL.md"
const PLUGIN_DIR = ".claude-plugin"
const PLUGIN_FILENAME = "plugin.json"

type ExistsResult =
	| { ok: true; value: boolean }
	| { ok: false; error: PackageDetectionError }
type ReadDirResult =
	| { ok: true; value: Dirent<string>[] }
	| { ok: false; error: PackageDetectionError }
type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> | null }
	| { ok: false; error: PackageDetectionError }

export async function detectPackageType(
	packagePath: string,
): Promise<PackageDetectionResult> {
	const rootPath = path.resolve(packagePath)
	const rootStat = await safeStat(rootPath)
	if (!rootStat.ok) {
		return rootStat
	}

	if (!rootStat.value) {
		return failure(
			"invalid_package",
			`Package path does not exist: ${rootPath}`,
			rootPath,
		)
	}

	if (!rootStat.value.isDirectory()) {
		return failure(
			"invalid_package",
			`Package path is not a directory: ${rootPath}`,
			rootPath,
		)
	}

	const manifestPath = path.join(rootPath, MANIFEST_FILENAME)
	const manifestExists = await fileExists(manifestPath, rootPath)
	if (!manifestExists.ok) {
		return manifestExists
	}

	if (manifestExists.value) {
		return {
			ok: true,
			value: {
				manifestPath,
				rootPath,
				type: "manifest",
			},
		}
	}

	const pluginDir = path.join(rootPath, PLUGIN_DIR)
	const pluginDirExists = await dirExists(pluginDir, rootPath)
	if (!pluginDirExists.ok) {
		return pluginDirExists
	}

	if (pluginDirExists.value) {
		const pluginPath = path.join(pluginDir, PLUGIN_FILENAME)
		const pluginFileExists = await fileExists(pluginPath, rootPath)
		if (!pluginFileExists.ok) {
			return pluginFileExists
		}

		if (!pluginFileExists.value) {
			return failure(
				"invalid_package",
				`Found ${PLUGIN_DIR} without ${PLUGIN_FILENAME}.`,
				rootPath,
			)
		}

		return {
			ok: true,
			value: {
				pluginPath,
				rootPath,
				type: "plugin",
			},
		}
	}

	const subdirSkills = await detectSubdirSkills(rootPath)
	if (!subdirSkills.ok) {
		return subdirSkills
	}

	if (subdirSkills.value.length > 0) {
		return {
			ok: true,
			value: {
				rootPath,
				skillDirs: subdirSkills.value,
				type: "subdir",
			},
		}
	}

	const rootSkillPath = path.join(rootPath, SKILL_FILENAME)
	const rootSkillExists = await fileExists(rootSkillPath, rootPath)
	if (!rootSkillExists.ok) {
		return rootSkillExists
	}

	if (rootSkillExists.value) {
		return {
			ok: true,
			value: {
				rootPath,
				skillDir: rootPath,
				type: "single",
			},
		}
	}

	return failure(
		"invalid_package",
		"No package.toml, plugin.json, or SKILL.md found in package.",
		rootPath,
	)
}

async function detectSubdirSkills(
	rootPath: string,
): Promise<{ ok: true; value: string[] } | { ok: false; error: PackageDetectionError }> {
	const entriesResult = await readDirEntries(rootPath)
	if (!entriesResult.ok) {
		return entriesResult
	}

	const entries = entriesResult.value

	const skillDirs: string[] = []
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}

		const skillDir = path.join(rootPath, entry.name)
		const skillFile = path.join(skillDir, SKILL_FILENAME)
		const skillExists = await fileExists(skillFile, rootPath)
		if (!skillExists.ok) {
			return skillExists
		}

		if (skillExists.value) {
			skillDirs.push(skillDir)
		}
	}

	return { ok: true, value: skillDirs }
}

async function readDirEntries(rootPath: string): Promise<ReadDirResult> {
	try {
		const entries = await readdir(rootPath, {
			encoding: "utf8",
			withFileTypes: true,
		})
		return { ok: true, value: entries }
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to read ${rootPath}.`),
			rootPath,
		)
	}
}

async function fileExists(targetPath: string, rootPath: string): Promise<ExistsResult> {
	const stats = await safeStat(targetPath)
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

async function dirExists(targetPath: string, rootPath: string): Promise<ExistsResult> {
	const stats = await safeStat(targetPath)
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

async function safeStat(targetPath: string): Promise<StatResult> {
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
			targetPath,
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
	pathValue: string,
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
