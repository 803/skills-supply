import type { AbsolutePath } from "@skills-supply/core"
import { validateManifest } from "@skills-supply/core"
import type { ManifestParseResult } from "@/manifest/types"
import type { ManifestDiscoveredAt } from "@/types/context"

export function parseManifest(
	contents: string,
	sourcePath: AbsolutePath,
	discoveredAt: ManifestDiscoveredAt,
): ManifestParseResult {
	const adapted = validateManifest(contents, sourcePath)
	if (!adapted.ok) {
		return adapted
	}

	return {
		ok: true,
		value: {
			...adapted.value,
			origin: { discoveredAt, sourcePath },
		},
	}
}
