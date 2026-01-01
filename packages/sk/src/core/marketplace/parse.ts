export interface MarketplacePluginEntry {
	name: string
	source: unknown
}

export interface MarketplaceManifest {
	name: string
	plugins: MarketplacePluginEntry[]
	pluginRoot?: string
}

export type MarketplaceParseResult =
	| { ok: true; value: MarketplaceManifest }
	| { ok: false; error: string }

export function parseMarketplaceJson(
	contents: string,
	manifestPath: string,
): MarketplaceParseResult {
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		return {
			error:
				error instanceof Error
					? `Invalid JSON in ${manifestPath}. ${error.message}`
					: `Invalid JSON in ${manifestPath}.`,
			ok: false,
		}
	}

	if (!isRecord(parsed)) {
		return { error: "Marketplace manifest must be a JSON object.", ok: false }
	}

	const nameValue = parsed.name
	if (typeof nameValue !== "string" || !nameValue.trim()) {
		return {
			error: "Marketplace manifest must include a non-empty name.",
			ok: false,
		}
	}

	const pluginsValue = parsed.plugins
	if (!Array.isArray(pluginsValue)) {
		return { error: "Marketplace manifest must include a plugins array.", ok: false }
	}

	const plugins: MarketplacePluginEntry[] = []
	for (const entry of pluginsValue) {
		if (!isRecord(entry)) {
			return { error: "Marketplace plugins must be objects.", ok: false }
		}

		const pluginName = entry.name
		if (typeof pluginName !== "string" || !pluginName.trim()) {
			return {
				error: "Marketplace plugins must include a non-empty name.",
				ok: false,
			}
		}

		if (!("source" in entry)) {
			return {
				error: `Marketplace plugin "${pluginName}" is missing source.`,
				ok: false,
			}
		}

		plugins.push({
			name: pluginName.trim(),
			source: entry.source,
		})
	}

	let pluginRoot: string | undefined
	if ("metadata" in parsed && parsed.metadata !== undefined) {
		const metadata = parsed.metadata
		if (!isRecord(metadata)) {
			return { error: "Marketplace metadata must be a JSON object.", ok: false }
		}

		if ("pluginRoot" in metadata) {
			const pluginRootValue = metadata.pluginRoot
			if (typeof pluginRootValue !== "string" || !pluginRootValue.trim()) {
				return {
					error: "Marketplace metadata.pluginRoot must be a non-empty string.",
					ok: false,
				}
			}
			pluginRoot = pluginRootValue.trim()
		}
	}

	return { ok: true, value: { name: nameValue.trim(), pluginRoot, plugins } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
