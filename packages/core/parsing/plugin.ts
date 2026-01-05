import { z } from "zod"
import type { NonEmptyString } from "@/types/branded"
import type { PluginInfo } from "@/types/content"
import type { Result } from "@/types/error"

const NonEmptyStringSchema = z
	.string()
	.trim()
	.min(1)
	.transform((value) => value as NonEmptyString)

const OptionalNonEmptyStringSchema = NonEmptyStringSchema.optional()

const PluginSchema = z.object({
	description: OptionalNonEmptyStringSchema,
	name: NonEmptyStringSchema,
	version: OptionalNonEmptyStringSchema,
})

export function parsePlugin(contents: string): Result<PluginInfo> {
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		return {
			error: {
				message: "Invalid JSON in plugin.json.",
				rawError: error instanceof Error ? error : undefined,
				source: "plugin.json",
				type: "parse",
			},
			ok: false,
		}
	}

	const result = PluginSchema.safeParse(parsed)
	if (!result.success) {
		return {
			error: {
				field: "plugin",
				message: "Plugin validation failed.",
				source: "zod",
				type: "validation",
				zodError: result.error,
			},
			ok: false,
		}
	}

	return { ok: true, value: result.data }
}
