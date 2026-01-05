import { readFile } from "node:fs/promises"
import path from "node:path"
import type { AbsolutePath } from "@skills-supply/core"
import {
	type CoreError,
	coerceAbsolutePath,
	discoverSkillPathsForPlugin,
	discoverSkillPathsForSubdir,
	PLUGIN_SKILLS_DIR,
	parseFrontmatter,
	SKILL_FILENAME,
} from "@skills-supply/core"
import { parseManifest } from "@/manifest/parse"
import type {
	DetectedPackage,
	PackageExtractionError,
	PackageExtractionResult,
	Skill,
} from "@/packages/types"

type SkillResult =
	| { ok: true; value: Skill }
	| { ok: false; error: PackageExtractionError }

export async function extractSkills(
	detected: DetectedPackage,
): Promise<PackageExtractionResult> {
	const origin = detected.canonical.origin

	switch (detected.detection.method) {
		case "manifest":
			return extractFromManifest(detected.detection.manifestPath, origin)
		case "plugin": {
			if (!detected.detection.skillsDir) {
				const expectedPath =
					coerceAbsolutePath(PLUGIN_SKILLS_DIR, detected.packagePath) ??
					detected.packagePath
				const message = `Plugin skills directory not found: ${expectedPath}.`
				return {
					error: {
						field: "skills",
						message,
						origin,
						path: expectedPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const skillDirs = await discoverSkillPathsForPlugin(
				detected.detection.skillsDir,
			)
			if (!skillDirs.ok) {
				return mapCoreError(skillDirs.error, detected.detection.skillsDir, origin)
			}

			if (skillDirs.value.length === 0) {
				const message = `No skills found in ${detected.detection.skillsDir}.`
				return {
					error: {
						field: "skills",
						message,
						origin,
						path: detected.detection.skillsDir,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			return buildSkillList(skillDirs.value, origin)
		}
		case "subdir": {
			const skillDirs = await discoverSkillPathsForSubdir(
				detected.detection.rootDir,
			)
			if (!skillDirs.ok) {
				return mapCoreError(skillDirs.error, detected.detection.rootDir, origin)
			}
			if (skillDirs.value.length === 0) {
				const message = `No skills found in ${detected.detection.rootDir}.`
				return {
					error: {
						field: "skills",
						message,
						origin,
						path: detected.detection.rootDir,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			return buildSkillList(skillDirs.value, origin)
		}
		case "single":
			return buildSkillList([detected.detection.skillPath], origin)
	}

	return {
		error: {
			field: "structure",
			message: `Unsupported package structure: ${detected.detection.method}.`,
			origin,
			path: detected.packagePath,
			source: "manual",
			type: "validation",
		},
		ok: false,
	}
}

async function extractFromManifest(
	manifestPath: AbsolutePath,
	origin: Skill["origin"],
): Promise<PackageExtractionResult> {
	let contents: string

	try {
		contents = await readFile(manifestPath, "utf8")
	} catch (error) {
		return {
			error: {
				message: `Unable to read ${manifestPath}.`,
				operation: "readFile",
				origin,
				path: manifestPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	const parsed = parseManifest(contents, manifestPath, "cwd")
	if (!parsed.ok) {
		const message = "Manifest validation failed."
		const zodError =
			parsed.error.type === "validation" && parsed.error.source === "zod"
				? parsed.error.zodError
				: undefined
		if (zodError) {
			return {
				error: {
					cause: parsed.error,
					field: "manifest",
					message,
					origin,
					path: manifestPath,
					source: "zod",
					type: "validation",
					zodError,
				},
				ok: false,
			}
		}
		return {
			error: {
				cause: parsed.error,
				field: "manifest",
				message,
				origin,
				path: manifestPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const skillsSetting = resolveAutoDiscoverSkills(parsed.value.exports)
	if (skillsSetting === false) {
		const message = "Skill auto-discovery is disabled in agents.toml."
		return {
			error: {
				field: "exports.auto_discover.skills",
				message,
				origin,
				path: manifestPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const skillsRoot = coerceAbsolutePath(skillsSetting, path.dirname(manifestPath))
	if (!skillsRoot) {
		const message = `Invalid skills path "${skillsSetting}" in ${manifestPath}.`
		return {
			error: {
				field: "exports.auto_discover.skills",
				message,
				origin,
				path: manifestPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const skillDirs = await discoverSkillPathsForSubdir(skillsRoot)
	if (!skillDirs.ok) {
		return mapCoreError(skillDirs.error, skillsRoot, origin)
	}
	if (skillDirs.value.length === 0) {
		const message = `No skills found in ${skillsRoot}.`
		return {
			error: {
				field: "skills",
				message,
				origin,
				path: skillsRoot,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return buildSkillList(skillDirs.value, origin)
}

function resolveAutoDiscoverSkills(
	exportsValue: { auto_discover?: { skills: string | false } } | undefined,
): string | false {
	const value = exportsValue?.auto_discover?.skills
	if (value === false) {
		return false
	}

	if (typeof value === "string") {
		return value
	}

	return "./skills"
}

async function buildSkillList(
	skillDirs: readonly AbsolutePath[],
	origin: Skill["origin"],
): Promise<PackageExtractionResult> {
	const skills: Skill[] = []
	const seen = new Set<string>()

	for (const skillDir of skillDirs) {
		const skillResult = await loadSkillFromDir(skillDir, origin)
		if (!skillResult.ok) {
			return skillResult
		}

		if (seen.has(skillResult.value.name)) {
			const message = `Duplicate skill name "${skillResult.value.name}" found.`
			return {
				error: {
					field: "skills",
					message,
					origin,
					path: skillDir,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		seen.add(skillResult.value.name)
		skills.push(skillResult.value)
	}

	return { ok: true, value: skills }
}

async function loadSkillFromDir(
	skillDir: AbsolutePath,
	origin: Skill["origin"],
): Promise<SkillResult> {
	const skillPath = coerceAbsolutePath(SKILL_FILENAME, skillDir)
	if (!skillPath) {
		const message = `Unable to resolve ${SKILL_FILENAME} under ${skillDir}.`
		return {
			error: {
				field: "skillPath",
				message,
				origin,
				path: skillDir,
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
				origin,
				path: skillPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	const parsed = parseFrontmatter(contents)
	if (!parsed.ok) {
		const message = "Skill frontmatter validation failed."
		const zodError =
			parsed.error.type === "validation" && parsed.error.source === "zod"
				? parsed.error.zodError
				: undefined
		if (zodError) {
			return {
				error: {
					cause: parsed.error,
					field: "frontmatter",
					message,
					origin,
					path: skillPath,
					source: "zod",
					type: "validation",
					zodError,
				},
				ok: false,
			}
		}
		return {
			error: {
				cause: parsed.error,
				field: "frontmatter",
				message,
				origin,
				path: skillPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			name: parsed.value.name,
			origin,
			sourcePath: skillDir,
		},
	}
}

function mapCoreError(
	error: CoreError,
	fallbackPath: AbsolutePath,
	origin: Skill["origin"],
): PackageExtractionResult {
	if (error.type === "io") {
		return {
			error: {
				...error,
				origin,
				path: error.path ?? fallbackPath,
			},
			ok: false,
		}
	}

	if (error.type === "not_found") {
		return {
			error: {
				...error,
				origin,
				path: error.path ?? fallbackPath,
			},
			ok: false,
		}
	}

	const field =
		"field" in error && typeof error.field === "string"
			? error.field
			: "source" in error && typeof error.source === "string"
				? error.source
				: "skills"
	const zodError =
		error.type === "validation" && error.source === "zod" ? error.zodError : undefined
	if (zodError) {
		return {
			error: {
				cause: error,
				field,
				message: error.message,
				origin,
				path: error.path ?? fallbackPath,
				source: "zod",
				type: "validation",
				zodError,
			},
			ok: false,
		}
	}

	return {
		error: {
			cause: error,
			field,
			message: error.message,
			origin,
			path: error.path ?? fallbackPath,
			source: "manual",
			type: "validation",
		},
		ok: false,
	}
}
