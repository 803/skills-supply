import type { ManifestInfo } from "@/types/content"

export function resolveAutoDiscoverSkills(
	exportsValue: ManifestInfo["exports"] | undefined,
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
