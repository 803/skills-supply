import { isCancel, select } from "@clack/prompts"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveGlobalManifest,
	resolveLocalManifest,
	warnIfSubdirectory,
} from "@/src/commands/manifest-selection"
import type { AddOptions, NormalizedAddOptions } from "@/src/commands/pkg/spec"
import {
	buildPackageSpec,
	isAutoDetectUrl,
	normalizeAddOptions,
} from "@/src/commands/pkg/spec"
import { syncWithSelection } from "@/src/commands/sync"
import { CommandResult, printOutcome } from "@/src/commands/types"
import { coerceDependency } from "@/src/core/manifest/coerce"
import { saveManifest } from "@/src/core/manifest/fs"
import { addDependency, getDependency } from "@/src/core/manifest/transform"
import type { DependencyDraft, ValidatedDependency } from "@/src/core/manifest/types"
import { autoDetectPackage } from "@/src/core/packages/auto-detect"
import { coerceAlias, coerceGitRef } from "@/src/core/types/coerce"
import { formatError } from "@/src/utils/errors"

export interface PkgAddCommandOptions extends AddOptions {
	global: boolean
	init: boolean
	nonInteractive: boolean
	sync: boolean
}

export async function pkgAdd(
	typeOrUrl: string,
	spec: string | undefined,
	options: PkgAddCommandOptions,
): Promise<void> {
	consola.info("sk pkg add")

	try {
		const normalizedOptions = normalizeAddOptions(options)
		const pkgSpecResult =
			spec === undefined
				? await resolveAutoDetectSpec(typeOrUrl, normalizedOptions, options)
				: CommandResult.completed(
						buildPackageSpec(typeOrUrl, spec, normalizedOptions),
					)
		if (pkgSpecResult.status !== "completed") {
			printOutcome(pkgSpecResult)
			return
		}
		const pkgSpec = pkgSpecResult.value

		const selectionResult = options.global
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

		if (selectionResult.status !== "completed") {
			printOutcome(selectionResult)
			return
		}
		const selection = selectionResult.value

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
		let manifestForSync = selection.manifest

		if (changed) {
			const updated = addDependency(selection.manifest, alias, coerced.value)
			await saveManifest(
				updated,
				selection.manifestPath,
				selection.serializeOptions,
			)
			manifestForSync = updated
		}

		const noChangeReason = `Dependency already present: ${pkgSpec.alias}. Manifest: ${selection.manifestPath} (no changes).`
		let outcome = CommandResult.completed(undefined)

		if (!changed && !options.sync) {
			outcome = CommandResult.unchanged(noChangeReason)
		}

		if (changed) {
			consola.success("Dependency settings updated.")
			if (selection.created) {
				consola.info(`Created ${selection.manifestPath}.`)
			}
			consola.success(`Added dependency: ${pkgSpec.alias}.`)
			consola.info(`Manifest: ${selection.manifestPath} (updated).`)
		} else if (options.sync) {
			consola.info(`Dependency already present: ${pkgSpec.alias}.`)
			consola.info(`Manifest: ${selection.manifestPath} (no changes).`)
		}

		if (options.sync) {
			const syncResult = await syncWithSelection(
				{ ...selection, manifest: manifestForSync },
				{ dryRun: false, nonInteractive: options.nonInteractive },
			)
			if (syncResult.status === "failed") {
				printOutcome(CommandResult.failed())
				return
			}
			if (syncResult.status === "cancelled") {
				consola.info("Sync skipped.")
			} else if (syncResult.status === "unchanged") {
				consola.info(syncResult.reason)
			}
		}

		printOutcome(outcome)
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Package update failed.")
	}
}

async function resolveAutoDetectSpec(
	input: string,
	options: NormalizedAddOptions,
	commandOptions: PkgAddCommandOptions,
): Promise<CommandResult<DependencyDraft>> {
	const trimmed = input.trim()
	if (!trimmed) {
		throw new Error("Package type or URL is required.")
	}

	if (!isAutoDetectUrl(trimmed)) {
		throw new Error("Package spec is required.")
	}

	const ref = options.ref ? coerceGitRef(options.ref) : null
	if (options.ref && !ref) {
		throw new Error("Invalid git ref options.")
	}

	consola.info("Cloning repository...")
	const detected = await autoDetectPackage(trimmed, {
		path: options.path,
		ref: ref ?? undefined,
	})
	if (!detected.ok) {
		throw new Error(detected.error)
	}

	const detection = detected.detection
	if (detection.method === "marketplace") {
		if (options.ref) {
			throw new Error("--tag/--branch/--rev are not valid for marketplace plugins.")
		}
		if (options.path) {
			consola.info(
				"Note: --path is used for detection only; marketplace plugins do not support subpaths.",
			)
		}

		const pluginOptions: NormalizedAddOptions = {
			aliasOverride: options.aliasOverride,
		}
		const pluginResult = await selectMarketplacePlugin(
			detection.marketplace,
			commandOptions.nonInteractive,
		)
		if (pluginResult.status !== "completed") {
			return pluginResult
		}
		const marketplaceSpec =
			detected.source.type === "github" ? detected.source.slug : detected.source.url
		const spec = `${pluginResult.value}@${marketplaceSpec}`
		return CommandResult.completed(
			buildPackageSpec("claude-plugin", spec, pluginOptions),
		)
	}

	const spec =
		detected.source.type === "github" ? detected.source.slug : detected.source.url
	const type = detected.source.type === "github" ? "github" : "git"
	consola.info(`Detected ${detection.method} package.`)
	return CommandResult.completed(buildPackageSpec(type, spec, options))
}

async function selectMarketplacePlugin(
	marketplace: {
		name: string
		plugins: string[]
	},
	nonInteractive: boolean,
): Promise<CommandResult<string>> {
	if (marketplace.plugins.length === 0) {
		throw new Error(`Marketplace "${marketplace.name}" has no plugins.`)
	}

	if (marketplace.plugins.length === 1) {
		const [plugin] = marketplace.plugins
		if (!plugin) {
			throw new Error(`Marketplace "${marketplace.name}" has no plugins.`)
		}
		consola.info(`Detected marketplace with 1 plugin: "${plugin}".`)
		consola.info(`Auto-selecting plugin: ${plugin}`)
		return CommandResult.completed(plugin)
	}

	consola.info(`Detected marketplace with ${marketplace.plugins.length} plugins.`)

	if (nonInteractive) {
		throw new Error(
			"Marketplace has multiple plugins. Run interactively to select which plugin to install.",
		)
	}

	const selection = await select({
		message: "Select a plugin to add",
		options: marketplace.plugins.map((plugin) => ({
			label: plugin,
			value: plugin,
		})),
	})

	if (isCancel(selection)) {
		return CommandResult.cancelled()
	}

	if (typeof selection !== "string") {
		throw new Error("Invalid plugin selection.")
	}

	return CommandResult.completed(selection)
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
