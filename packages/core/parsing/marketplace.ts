import { z } from "zod"
import type { NonEmptyString } from "@/types/branded"
import type { MarketplaceInfo } from "@/types/content"
import type { Result } from "@/types/error"

const NonEmptyStringSchema = z
	.string()
	.trim()
	.min(1)
	.transform((value) => value as NonEmptyString)

const OptionalNonEmptyStringSchema = NonEmptyStringSchema.optional()

const AuthorSchema = z
	.object({
		email: OptionalNonEmptyStringSchema,
		name: OptionalNonEmptyStringSchema,
	})
	.optional()

const MarketplaceSourceSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
	z.array(z.unknown()),
	z.record(z.string(), z.unknown()),
])

const MarketplacePluginSchema = z.object({
	author: AuthorSchema,
	category: OptionalNonEmptyStringSchema,
	description: OptionalNonEmptyStringSchema,
	homepage: OptionalNonEmptyStringSchema,
	keywords: z.array(NonEmptyStringSchema).optional(),
	license: OptionalNonEmptyStringSchema,
	name: NonEmptyStringSchema,
	repository: OptionalNonEmptyStringSchema,
	source: MarketplaceSourceSchema,
	version: OptionalNonEmptyStringSchema,
})

const MarketplaceMetadataSchema = z
	.object({
		description: OptionalNonEmptyStringSchema,
		pluginRoot: OptionalNonEmptyStringSchema,
		version: OptionalNonEmptyStringSchema,
	})
	.optional()

const MarketplaceSchema: z.ZodType<MarketplaceInfo> = z.object({
	metadata: MarketplaceMetadataSchema,
	name: NonEmptyStringSchema,
	owner: z
		.object({
			email: OptionalNonEmptyStringSchema,
			name: NonEmptyStringSchema,
		})
		.optional(),
	plugins: z.array(MarketplacePluginSchema),
})

export function parseMarketplace(contents: string): Result<MarketplaceInfo> {
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		return {
			error: {
				message: "Invalid JSON in marketplace.json.",
				rawError: error instanceof Error ? error : undefined,
				source: "marketplace.json",
				type: "parse",
			},
			ok: false,
		}
	}

	const result = MarketplaceSchema.safeParse(parsed)
	if (!result.success) {
		return {
			error: {
				field: "marketplace",
				message: "Marketplace validation failed.",
				source: "zod",
				type: "validation",
				zodError: result.error,
			},
			ok: false,
		}
	}

	return { ok: true, value: result.data }
}
