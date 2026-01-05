import { failSync } from "@/sync/errors"
import type { ExtractedPackage, SyncResult } from "@/sync/types"

export function validateExtractedPackages(
	packages: ExtractedPackage[],
): SyncResult<void> {
	const seenTargets = new Set<string>()

	for (const pkg of packages) {
		const prefix = pkg.prefix.trim()
		if (!prefix) {
			return failSync("validate", {
				field: "prefix",
				message: "Package prefix cannot be empty.",
				source: "manual",
				type: "validation",
			})
		}

		if (pkg.skills.length === 0) {
			return failSync("validate", {
				field: "skills",
				message: `Package "${pkg.prefix}" has no skills to install.`,
				source: "manual",
				type: "validation",
			})
		}

		for (const skill of pkg.skills) {
			const name = skill.name.trim()
			if (!name) {
				return failSync("validate", {
					field: "skills",
					message: `Package "${pkg.prefix}" has an empty skill name.`,
					source: "manual",
					type: "validation",
				})
			}

			const targetName = `${prefix}-${name}`
			if (seenTargets.has(targetName)) {
				return failSync("validate", {
					field: "skills",
					message: `Duplicate skill target detected: ${targetName}`,
					source: "manual",
					type: "validation",
				})
			}

			seenTargets.add(targetName)
		}
	}

	return { ok: true, value: undefined }
}
