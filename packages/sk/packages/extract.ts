import { readFile } from "node:fs/promises"
import path from "node:path"
import type { AbsolutePath, ExtractedSkill } from "@skills-supply/core"
import {
	type CoreError,
	coerceAbsolutePath,
	coerceAbsolutePathDirect,
	extractSkillsFromPlugin,
	extractSkillsFromSingle,
	extractSkillsFromSubdir,
	PLUGIN_SKILLS_DIR,
	resolveAutoDiscoverSkills,
} from "@skills-supply/core"
import { parseManifest } from "@/manifest/parse"
import type { DetectedPackage, PackageExtractionResult, Skill } from "@/packages/types"

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

			const extracted = await extractSkillsFromPlugin({
				mode: "strict",
				packageRoot: detected.packagePath,
				skillsDir: detected.detection.skillsDir,
			})
			if (!extracted.ok) {
				return mapCoreError(extracted.error, detected.detection.skillsDir, origin)
			}

			if (extracted.value.skills.length === 0) {
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

			return buildSkillList(extracted.value.skills, origin)
		}
		case "subdir": {
			const extracted = await extractSkillsFromSubdir({
				mode: "strict",
				packageRoot: detected.detection.rootDir,
				rootDir: detected.detection.rootDir,
			})
			if (!extracted.ok) {
				return mapCoreError(extracted.error, detected.detection.rootDir, origin)
			}
			if (extracted.value.skills.length === 0) {
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
			return buildSkillList(extracted.value.skills, origin)
		}
		case "single":
			return buildSkillListFromSingle(detected.detection.skillPath, origin)
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

	const packageRoot = coerceAbsolutePathDirect(path.dirname(manifestPath))
	if (!packageRoot) {
		const message = `Manifest root is not absolute: ${manifestPath}`
		return {
			error: {
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

	const extracted = await extractSkillsFromSubdir({
		mode: "strict",
		packageRoot,
		rootDir: skillsRoot,
	})
	if (!extracted.ok) {
		return mapCoreError(extracted.error, skillsRoot, origin)
	}
	if (extracted.value.skills.length === 0) {
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

	return buildSkillList(extracted.value.skills, origin)
}

async function buildSkillList(
	skills: ExtractedSkill[],
	origin: Skill["origin"],
): Promise<PackageExtractionResult> {
	return {
		ok: true,
		value: skills.map((skill) => ({
			name: skill.name,
			origin,
			sourcePath: skill.sourcePath,
		})),
	}
}

async function buildSkillListFromSingle(
	skillDir: AbsolutePath,
	origin: Skill["origin"],
): Promise<PackageExtractionResult> {
	const extracted = await extractSkillsFromSingle({
		mode: "strict",
		packageRoot: skillDir,
		skillDir,
	})
	if (!extracted.ok) {
		return mapCoreError(extracted.error, skillDir, origin)
	}

	if (extracted.value.skills.length === 0) {
		const message = `No skills found in ${skillDir}.`
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

	return buildSkillList(extracted.value.skills, origin)
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
