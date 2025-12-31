import { consola } from "consola"
import { loadManifestForUpdate } from "@/src/commands/manifest-prompt"
import type { AddOptions } from "@/src/commands/pkg/spec"
import { buildPackageSpec } from "@/src/commands/pkg/spec"
import { coerceDependency } from "@/src/core/manifest/coerce"
import { saveManifest } from "@/src/core/manifest/fs"
import { addDependency, getDependency } from "@/src/core/manifest/transform"
import type { ValidatedDependency } from "@/src/core/manifest/types"
import { coerceAlias } from "@/src/core/types/coerce"
import { formatError } from "@/src/utils/errors"

export async function pkgAdd(
	type: string,
	spec: string,
	options: AddOptions,
): Promise<void> {
	consola.info("sk pkg add")
	consola.start("Updating dependencies...")

	try {
		const pkgSpec = buildPackageSpec(type, spec, options)
		const manifestResult = await loadManifestForUpdate()

		const alias = coerceAlias(pkgSpec.alias)
		if (!alias) {
			throw new Error(`Invalid alias: ${pkgSpec.alias}`)
		}

		// Coerce the declaration to a validated dependency
		const coerced = coerceDependency(
			pkgSpec.declaration,
			pkgSpec.alias,
			manifestResult.manifestPath,
		)
		if (!coerced.ok) {
			throw new Error(coerced.error.message)
		}

		const current = getDependency(manifestResult.manifest, alias)
		const changed = !areDependenciesEqual(current, coerced.value)

		if (changed) {
			const updated = addDependency(manifestResult.manifest, alias, coerced.value)
			await saveManifest(updated, manifestResult.manifestPath)
		}

		consola.success("Dependency settings updated.")
		if (manifestResult.created) {
			consola.info(`Created ${manifestResult.manifestPath}.`)
		}

		if (!changed) {
			consola.info(`Dependency already present: ${pkgSpec.alias}.`)
			consola.info(`Manifest: ${manifestResult.manifestPath} (no changes).`)
			consola.success("Done.")
			return
		}

		consola.success(`Added dependency: ${pkgSpec.alias}.`)
		consola.info(`Manifest: ${manifestResult.manifestPath} (updated).`)
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Package update failed.")
	}
}

function areDependenciesEqual(
	current: ValidatedDependency | undefined,
	next: ValidatedDependency,
): boolean {
	if (current === undefined) {
		return false
	}

	if (current.type !== next.type) {
		return false
	}

	// Compare serialized form for deep equality
	return JSON.stringify(current) === JSON.stringify(next)
}
