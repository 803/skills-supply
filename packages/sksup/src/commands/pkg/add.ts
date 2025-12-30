import { confirm, intro, isCancel, log, note, outro, spinner } from "@clack/prompts"
import {
	isManifestNotFoundError,
	loadManifestFromCwd,
	type ManifestLoadResult,
	saveManifest,
} from "@/commands/manifest"
import type { AddOptions } from "@/commands/pkg/spec"
import { buildPackageSpec } from "@/commands/pkg/spec"
import type { DependencyDeclaration } from "@/core/manifest/types"
import { formatError } from "@/utils/errors"

export async function pkgAdd(
	type: string,
	spec: string,
	options: AddOptions,
): Promise<void> {
	intro("sksup pkg add")

	const action = spinner()
	action.start("Updating dependencies...")

	try {
		const pkgSpec = buildPackageSpec(type, spec, options)
		const manifestResult = await loadManifestForUpdate()

		const current = manifestResult.manifest.dependencies[pkgSpec.alias]
		const changed = !areDeclarationsEqual(current, pkgSpec.declaration)

		if (changed) {
			manifestResult.manifest.dependencies[pkgSpec.alias] = pkgSpec.declaration
			await saveManifest(manifestResult.manifest, manifestResult.manifestPath)
		}

		action.stop("Dependency settings updated.")
		if (manifestResult.created) {
			log.info(`Created ${manifestResult.manifestPath}.`)
		}

		if (!changed) {
			log.info(`Dependency already present: ${pkgSpec.alias}.`)
			note(`Manifest: ${manifestResult.manifestPath}`, "No changes")
			outro("Done.")
			return
		}

		log.success(`Added dependency: ${pkgSpec.alias}.`)
		note(`Manifest: ${manifestResult.manifestPath}`, "Updated")
		outro("Done.")
	} catch (error) {
		action.stop("Failed to update dependencies.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Package update failed.")
	}
}

async function loadManifestForUpdate(): Promise<ManifestLoadResult> {
	try {
		return await loadManifestFromCwd({ createIfMissing: false })
	} catch (error) {
		if (!isManifestNotFoundError(error)) {
			throw error
		}

		const shouldCreate = await confirm({
			message: "package.toml not found. Create it?",
		})
		if (isCancel(shouldCreate) || !shouldCreate) {
			throw new Error("Canceled.")
		}

		return await loadManifestFromCwd({ createIfMissing: true })
	}
}

function areDeclarationsEqual(
	current: DependencyDeclaration | undefined,
	next: DependencyDeclaration,
): boolean {
	if (current === undefined) {
		return false
	}

	if (typeof current === "string" || typeof next === "string") {
		return current === next
	}

	return JSON.stringify(current) === JSON.stringify(next)
}
