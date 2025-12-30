import { confirm, intro, isCancel, log, note, outro, spinner } from "@clack/prompts"
import {
	isManifestNotFoundError,
	loadManifestFromCwd,
	type ManifestLoadResult,
	saveManifest,
} from "@/commands/manifest"
import type { AddOptions } from "@/commands/pkg/spec"
import { buildPackageSpec } from "@/commands/pkg/spec"
import type { PackageDeclaration } from "@/core/manifest/types"
import { formatError } from "@/utils/errors"

export async function pkgAdd(
	type: string,
	spec: string,
	options: AddOptions,
): Promise<void> {
	intro("sksup pkg add")

	const action = spinner()
	action.start("Updating packages...")

	try {
		const pkgSpec = buildPackageSpec(type, spec, options)
		const manifestResult = await loadManifestForUpdate()

		const current = manifestResult.manifest.packages[pkgSpec.alias]
		const changed = !areDeclarationsEqual(current, pkgSpec.declaration)

		if (changed) {
			manifestResult.manifest.packages[pkgSpec.alias] = pkgSpec.declaration
			await saveManifest(manifestResult.manifest, manifestResult.manifestPath)
		}

		action.stop("Package settings updated.")
		if (manifestResult.created) {
			log.info(`Created ${manifestResult.manifestPath}.`)
		}

		if (!changed) {
			log.info(`Package already present: ${pkgSpec.alias}.`)
			note(`Manifest: ${manifestResult.manifestPath}`, "No changes")
			outro("Done.")
			return
		}

		log.success(`Added package: ${pkgSpec.alias}.`)
		note(`Manifest: ${manifestResult.manifestPath}`, "Updated")
		outro("Done.")
	} catch (error) {
		action.stop("Failed to update packages.")
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
			message: "skills.toml not found. Create it?",
		})
		if (isCancel(shouldCreate) || !shouldCreate) {
			throw new Error("Canceled.")
		}

		return await loadManifestFromCwd({ createIfMissing: true })
	}
}

function areDeclarationsEqual(
	current: PackageDeclaration | undefined,
	next: PackageDeclaration,
): boolean {
	if (current === undefined) {
		return false
	}

	if (typeof current === "string" || typeof next === "string") {
		return current === next
	}

	return JSON.stringify(current) === JSON.stringify(next)
}
