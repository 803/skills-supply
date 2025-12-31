import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveGlobalManifest,
	resolveLocalManifest,
	warnIfSubdirectory,
} from "@/src/commands/manifest-selection"
import type { AddOptions } from "@/src/commands/pkg/spec"
import { buildPackageSpec } from "@/src/commands/pkg/spec"
import { coerceDependency } from "@/src/core/manifest/coerce"
import { saveManifest } from "@/src/core/manifest/fs"
import { addDependency, getDependency } from "@/src/core/manifest/transform"
import type { ValidatedDependency } from "@/src/core/manifest/types"
import { coerceAlias } from "@/src/core/types/coerce"
import { formatError } from "@/src/utils/errors"

export interface PkgAddCommandOptions extends AddOptions {
	global: boolean
	init: boolean
	nonInteractive: boolean
}

export async function pkgAdd(
	type: string,
	spec: string,
	options: PkgAddCommandOptions,
): Promise<void> {
	consola.info("sk pkg add")

	try {
		const pkgSpec = buildPackageSpec(type, spec, options)
		const selection = options.global
			? await resolveGlobalManifest({
					createIfMissing: options.init,
					nonInteractive: options.nonInteractive,
					promptToCreate: true,
				})
			: await resolveLocalManifest({
					createIfMissing: options.init,
					nonInteractive: options.nonInteractive,
					parentPrompt: {
						buildMessage: (projectRoot, cwd) =>
							buildParentPromptMessage(projectRoot, cwd, {
								action: "modify",
								warnAboutSkillVisibility: true,
							}),
					},
					promptToCreate: true,
				})

		if (!options.global) {
			warnIfSubdirectory(selection)
		}

		consola.start("Updating dependencies...")

		const alias = coerceAlias(pkgSpec.alias)
		if (!alias) {
			throw new Error(`Invalid alias: ${pkgSpec.alias}`)
		}

		// Coerce the declaration to a validated dependency
		const coerced = coerceDependency(
			pkgSpec.declaration,
			pkgSpec.alias,
			selection.manifestPath,
		)
		if (!coerced.ok) {
			throw new Error(coerced.error.message)
		}

		const current = getDependency(selection.manifest, alias)
		const changed = !areDependenciesEqual(current, coerced.value)

		if (changed) {
			const updated = addDependency(selection.manifest, alias, coerced.value)
			await saveManifest(
				updated,
				selection.manifestPath,
				selection.serializeOptions,
			)
		}

		consola.success("Dependency settings updated.")
		if (selection.created) {
			consola.info(`Created ${selection.manifestPath}.`)
		}

		if (!changed) {
			consola.info(`Dependency already present: ${pkgSpec.alias}.`)
			consola.info(`Manifest: ${selection.manifestPath} (no changes).`)
			consola.success("Done.")
			return
		}

		consola.success(`Added dependency: ${pkgSpec.alias}.`)
		consola.info(`Manifest: ${selection.manifestPath} (updated).`)
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
