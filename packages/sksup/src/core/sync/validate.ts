import { failSync } from "@/core/sync/errors"
import type { ExtractedPackage, SyncResult } from "@/core/sync/types"

export function validateExtractedPackages(
	packages: ExtractedPackage[],
): SyncResult<void> {
	const seenTargets = new Set<string>()

	for (const pkg of packages) {
		const prefix = pkg.prefix.trim()
		if (!prefix) {
			return failSync("validate", new Error("Package prefix cannot be empty."))
		}

		if (pkg.skills.length === 0) {
			return failSync(
				"validate",
				new Error(`Package "${pkg.prefix}" has no skills to install.`),
			)
		}

		for (const skill of pkg.skills) {
			const name = skill.name.trim()
			if (!name) {
				return failSync(
					"validate",
					new Error(`Package "${pkg.prefix}" has an empty skill name.`),
				)
			}

			const targetName = `${prefix}-${name}`
			if (seenTargets.has(targetName)) {
				return failSync(
					"validate",
					new Error(`Duplicate skill target detected: ${targetName}`),
				)
			}

			seenTargets.add(targetName)
		}
	}

	return { ok: true, value: undefined }
}
