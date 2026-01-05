import { readFile } from "node:fs/promises"
import path from "node:path"
import { SKILL_FILENAME } from "@/constants"
import {
	discoverSkillPathsForPlugin,
	discoverSkillPathsForSubdir,
} from "@/discovery/paths"
import { parseFrontmatter } from "@/parsing/frontmatter"
import type { AbsolutePath, NonEmptyString } from "@/types/branded"
import { coerceAbsolutePath, coerceNonEmpty } from "@/types/coerce"
import type { ExtractedSkill } from "@/types/content"
import type { CoreError, Result } from "@/types/error"

export type SkillExtractionMode = "lenient" | "strict"

export type SkillExtractionWarning = CoreError & { path: AbsolutePath }

export type SkillExtractionOutput = {
	skills: ExtractedSkill[]
	warnings: SkillExtractionWarning[]
}

export async function extractSkillsFromPlugin(options: {
	skillsDir: AbsolutePath
	packageRoot: AbsolutePath
	mode: SkillExtractionMode
}): Promise<Result<SkillExtractionOutput>> {
	const skillDirs = await discoverSkillPathsForPlugin(options.skillsDir)
	if (!skillDirs.ok) {
		return skillDirs
	}

	return extractSkillsFromDirs({
		mode: options.mode,
		packageRoot: options.packageRoot,
		skillDirs: skillDirs.value,
	})
}

export async function extractSkillsFromSubdir(options: {
	rootDir: AbsolutePath
	packageRoot: AbsolutePath
	mode: SkillExtractionMode
}): Promise<Result<SkillExtractionOutput>> {
	const skillDirs = await discoverSkillPathsForSubdir(options.rootDir)
	if (!skillDirs.ok) {
		return skillDirs
	}

	return extractSkillsFromDirs({
		mode: options.mode,
		packageRoot: options.packageRoot,
		skillDirs: skillDirs.value,
	})
}

export async function extractSkillsFromSingle(options: {
	skillDir: AbsolutePath
	packageRoot: AbsolutePath
	mode: SkillExtractionMode
}): Promise<Result<SkillExtractionOutput>> {
	return extractSkillsFromDirs({
		mode: options.mode,
		packageRoot: options.packageRoot,
		skillDirs: [options.skillDir],
	})
}

export async function extractSkillsFromDirs(options: {
	skillDirs: AbsolutePath[]
	packageRoot: AbsolutePath
	mode: SkillExtractionMode
}): Promise<Result<SkillExtractionOutput>> {
	const warnings: SkillExtractionWarning[] = []
	const skills: ExtractedSkill[] = []
	const seen = new Set<string>()

	for (const skillDir of options.skillDirs) {
		const skillResult = await loadSkillFromDir(skillDir, options.packageRoot)
		if (!skillResult.ok) {
			if (options.mode === "strict") {
				return skillResult
			}
			warnings.push(withWarningPath(skillResult.error, skillDir))
			continue
		}

		const skill = skillResult.value
		if (seen.has(skill.name)) {
			const message = `Duplicate skill name "${skill.name}" found.`
			const duplicateError: CoreError = {
				field: "skills",
				message,
				source: "manual",
				type: "validation",
			}
			if (options.mode === "strict") {
				return { error: duplicateError, ok: false }
			}
			warnings.push(withWarningPath(duplicateError, skill.sourcePath))
			continue
		}

		seen.add(skill.name)
		skills.push(skill)
	}

	return { ok: true, value: { skills, warnings } }
}

async function loadSkillFromDir(
	skillDir: AbsolutePath,
	packageRoot: AbsolutePath,
): Promise<Result<ExtractedSkill>> {
	const skillPath = coerceAbsolutePath(SKILL_FILENAME, skillDir)
	if (!skillPath) {
		const message = `Unable to resolve ${SKILL_FILENAME} under ${skillDir}.`
		return {
			error: {
				field: "skillPath",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	let contents: string
	try {
		contents = await readFile(skillPath, "utf8")
	} catch (error) {
		return {
			error: {
				message: `Unable to read ${skillPath}.`,
				operation: "readFile",
				path: skillPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	const parsed = parseFrontmatter(contents)
	if (!parsed.ok) {
		return {
			error: {
				...parsed.error,
				path: skillPath,
			},
			ok: false,
		}
	}

	const relativePath = toRelativePath(packageRoot, skillPath)
	if (!relativePath.ok) {
		return relativePath
	}

	return {
		ok: true,
		value: {
			description: parsed.value.description,
			name: parsed.value.name,
			relativePath: relativePath.value,
			sourcePath: skillDir,
		},
	}
}

function toRelativePath(
	basePath: AbsolutePath,
	targetPath: AbsolutePath,
): Result<NonEmptyString> {
	const relative = path.relative(basePath, targetPath)
	if (!relative || relative === ".") {
		const message = `Unable to resolve relative path for ${targetPath}.`
		return {
			error: {
				field: "relativePath",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (path.isAbsolute(relative) || relative.startsWith("..")) {
		const message = `Skill path is outside the package root: ${targetPath}.`
		return {
			error: {
				field: "relativePath",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const normalized = relative.split(path.sep).join("/")
	const coerced = coerceNonEmpty(normalized)
	if (!coerced) {
		const message = `Invalid relative path for ${targetPath}.`
		return {
			error: {
				field: "relativePath",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: coerced }
}

function withWarningPath(
	error: CoreError,
	fallbackPath: AbsolutePath,
): SkillExtractionWarning {
	if ("path" in error && typeof error.path === "string") {
		return error as SkillExtractionWarning
	}
	return { ...error, path: fallbackPath } as SkillExtractionWarning
}
