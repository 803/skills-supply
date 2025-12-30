import { parse, TomlError } from "smol-toml"
import { z } from "zod"
import type {
	ManifestExports,
	ManifestParseError,
	ManifestParseResult,
} from "@/core/manifest/types"

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

export function parseManifest(contents: string, sourcePath: string): ManifestParseResult {
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
	sourcePath: string,
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
