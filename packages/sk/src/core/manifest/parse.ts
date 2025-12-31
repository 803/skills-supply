import { parse, TomlError } from "smol-toml"
import { z } from "zod"
import type {
	LegacyManifest,
	LegacyManifestParseResult,
	ManifestExports,
	ManifestParseError,
	ManifestParseResult,
} from "@/core/manifest/types"
import type { AbsolutePath, ManifestDiscoveredAt } from "@/core/types/branded"
import { coerceAbsolutePathDirect } from "@/core/types/coerce"
import { coerceManifest, type RawParsedManifest } from "./coerce.js"

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ManifestParseError }

const trimmedString = (label: string) =>
	z
		.string()
		.transform((value) => value.trim())
		.refine((value) => value.length > 0, {
			message: `${label} must not be empty.`,
		})

const packageSchema = z
	.object({
		description: trimmedString("package.description").optional(),
		license: trimmedString("package.license").optional(),
		name: trimmedString("package.name"),
		org: trimmedString("package.org").optional(),
		version: trimmedString("package.version"),
	})
	.strict()

const refShape = {
	branch: trimmedString("branch").optional(),
	rev: trimmedString("rev").optional(),
	tag: trimmedString("tag").optional(),
}

const enforceSingleRef = (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
	const refs = ["tag", "branch", "rev"].filter((key) => value[key] !== undefined)
	if (refs.length > 1) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "Only one of tag, branch, or rev may be set.",
		})
	}
}

const githubSchema = z
	.object({
		gh: trimmedString("gh"),
		path: trimmedString("path").optional(),
		...refShape,
	})
	.strict()
	.superRefine(enforceSingleRef)

const gitSchema = z
	.object({
		git: trimmedString("git"),
		path: trimmedString("path").optional(),
		...refShape,
	})
	.strict()
	.superRefine(enforceSingleRef)

const localSchema = z
	.object({
		path: trimmedString("path"),
	})
	.strict()

const claudePluginSchema = z
	.object({
		marketplace: trimmedString("marketplace"),
		plugin: trimmedString("plugin"),
		type: z.literal("claude-plugin"),
	})
	.strict()

const dependencySchema = z.union([
	trimmedString("dependency"),
	githubSchema,
	gitSchema,
	localSchema,
	claudePluginSchema,
])

const agentsSchema = z.record(z.boolean())
const dependenciesSchema = z.record(dependencySchema)

const exportsSchema = z
	.object({
		auto_discover: z
			.object({
				skills: z.union([trimmedString("skills"), z.literal(false)]),
			})
			.strict(),
	})
	.strict()
	.transform(
		(value): ManifestExports => ({
			autoDiscover: {
				skills: value.auto_discover.skills,
			},
		}),
	)

const manifestSchema = z
	.object({
		agents: agentsSchema.optional(),
		dependencies: dependenciesSchema.optional(),
		exports: exportsSchema.optional(),
		package: packageSchema.optional(),
	})
	.strict()

/**
 * Parse a manifest file with full validation and coercion.
 * Returns a validated Manifest with branded types.
 *
 * @param contents - Raw TOML content
 * @param sourcePath - Absolute path to the manifest file
 * @param discoveredAt - How the manifest was discovered
 */
export function parseManifest(
	contents: string,
	sourcePath: AbsolutePath,
	discoveredAt: ManifestDiscoveredAt,
): ManifestParseResult {
	let data: unknown

	try {
		data = parse(contents)
	} catch (error) {
		const message =
			error instanceof TomlError
				? `Invalid TOML: ${error.message}`
				: "Invalid TOML."
		return failure("invalid_toml", message, sourcePath)
	}

	const parsed = manifestSchema.safeParse(data)
	if (!parsed.success) {
		return failure("invalid_manifest", formatZodError(parsed.error), sourcePath)
	}

	// Coerce to validated types at the boundary
	const raw: RawParsedManifest = {
		agents: parsed.data.agents,
		dependencies: parsed.data.dependencies,
		exports: parsed.data.exports,
		package: parsed.data.package,
	}

	return coerceManifest(raw, sourcePath, discoveredAt)
}

/**
 * Parse a manifest file without full validation.
 * Returns a legacy manifest with raw string types.
 *
 * @deprecated Use parseManifest instead for new code.
 */
export function parseLegacyManifest(
	contents: string,
	sourcePath: string,
): LegacyManifestParseResult {
	let data: unknown

	try {
		data = parse(contents)
	} catch (error) {
		const message =
			error instanceof TomlError
				? `Invalid TOML: ${error.message}`
				: "Invalid TOML."
		// Need to coerce sourcePath for error type compatibility
		const absPath = coerceAbsolutePathDirect(sourcePath)
		return failure("invalid_toml", message, absPath ?? (sourcePath as AbsolutePath))
	}

	const parsed = manifestSchema.safeParse(data)
	if (!parsed.success) {
		const absPath = coerceAbsolutePathDirect(sourcePath)
		return failure(
			"invalid_manifest",
			formatZodError(parsed.error),
			absPath ?? (sourcePath as AbsolutePath),
		)
	}

	return {
		ok: true,
		value: {
			agents: parsed.data.agents ?? {},
			dependencies: parsed.data.dependencies ?? {},
			exports: parsed.data.exports,
			package: parsed.data.package,
			sourcePath,
		},
	}
}

function formatZodError(error: z.ZodError): string {
	const issues = error.issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "manifest"
		return `${path}: ${issue.message}`
	})
	return `Invalid manifest: ${issues.join("; ")}`
}

function failure(
	type: ManifestParseError["type"],
	message: string,
	sourcePath: AbsolutePath,
	key?: string,
): ParseResult<never> {
	return {
		error: {
			key,
			message,
			sourcePath,
			type,
		},
		ok: false,
	}
}
