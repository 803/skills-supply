import { confirm, isCancel } from "@clack/prompts"
import { consola } from "consola"
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
	consola.info("sk pkg add")
	consola.start("Updating dependencies...")

	try {
		const pkgSpec = buildPackageSpec(type, spec, options)
		const manifestResult = await loadManifestForUpdate()

		const current = manifestResult.manifest.dependencies[pkgSpec.alias]
		const changed = !areDeclarationsEqual(current, pkgSpec.declaration)

		if (changed) {
			manifestResult.manifest.dependencies[pkgSpec.alias] = pkgSpec.declaration
			await saveManifest(manifestResult.manifest, manifestResult.manifestPath)
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
