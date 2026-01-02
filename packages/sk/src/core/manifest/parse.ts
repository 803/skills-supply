import { parse } from "@skills-supply/agents-toml"
import { adaptParseError, applyBrandedManifest } from "@/src/core/manifest/adapter"
import type { ManifestParseResult } from "@/src/core/manifest/types"
import type { AbsolutePath, ManifestDiscoveredAt } from "@/src/core/types/branded"

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
	const parsed = parse(contents)
	if (!parsed.ok) {
		return adaptParseError(parsed.error, sourcePath)
	}

	return applyBrandedManifest(parsed.value, sourcePath, discoveredAt)
}
