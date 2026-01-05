import matter from "gray-matter"
import { z } from "zod"
import type { NonEmptyString } from "@/types/branded"
import type { SkillInfo } from "@/types/content"
import type { Result } from "@/types/error"

const NonEmptyStringSchema = z
	.string()
	.trim()
	.min(1)
	.transform((value) => value as NonEmptyString)

const SkillSchema = z.object({
	description: NonEmptyStringSchema.optional(),
	name: NonEmptyStringSchema,
})

export function parseFrontmatter(contents: string): Result<SkillInfo> {
	const normalized = contents.replace(/\r\n/g, "\n")
	if (!normalized.startsWith("---\n")) {
		const message = "SKILL.md must start with YAML frontmatter."
		return {
			error: {
				field: "frontmatter",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const closingIndex = normalized.indexOf("\n---", 4)
	if (closingIndex === -1) {
		const message = "Frontmatter is missing a closing --- line."
		return {
			error: {
				field: "frontmatter",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	let parsed: matter.GrayMatterFile<string>
	try {
		parsed = matter(contents)
	} catch (error) {
		return {
			error: {
				message: "Invalid frontmatter.",
				rawError: error instanceof Error ? error : undefined,
				source: "frontmatter",
				type: "parse",
			},
			ok: false,
		}
	}

	if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
		const message = "Frontmatter must be a key/value map."
		return {
			error: {
				field: "frontmatter",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const result = SkillSchema.safeParse(parsed.data)
	if (!result.success) {
		return {
			error: {
				field: "frontmatter",
				message: "Frontmatter validation failed.",
				source: "zod",
				type: "validation",
				zodError: result.error,
			},
			ok: false,
		}
	}

	return { ok: true, value: result.data }
}
