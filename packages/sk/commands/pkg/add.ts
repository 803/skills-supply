import path from "node:path"
import { isCancel, multiselect, select, text } from "@clack/prompts"
import {
	type AbsolutePath,
	type Alias,
	coerceAbsolutePath,
	coerceAlias,
	coerceGitRef,
	coerceRemoteMarketplaceUrl,
	parseMarketplace,
	type ValidatedDeclaration,
	validateDeclaration,
} from "@skills-supply/core"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveGlobalManifest,
	resolveLocalManifest,
	warnIfSubdirectory,
} from "@/commands/manifest-selection"
import type { AddOptions, NormalizedAddOptions } from "@/commands/pkg/spec"
import {
	buildPackageSpec,
	isAutoDetectUrl,
	normalizeAddOptions,
} from "@/commands/pkg/spec"
import { syncWithSelection } from "@/commands/sync"
import { CommandResult, printOutcome } from "@/commands/types"
import { saveManifest } from "@/manifest/fs"
import { addDependency, getDependency } from "@/manifest/transform"
import type { DependencyDraft } from "@/manifest/types"
import { type AutoDetectSource, autoDetectPackage } from "@/packages/auto-detect"
import type { NetworkError } from "@/types/errors"

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

	const normalizedOptions = normalizeAddOptions(options)
	if (!normalizedOptions.ok) {
		printOutcome(CommandResult.failed(normalizedOptions.error))
		return
	}
	const pkgSpecResult =
		spec === undefined
			? await resolveAutoDetectSpec(typeOrUrl, normalizedOptions.value, options)
			: (() => {
					const built = buildPackageSpec(
						typeOrUrl,
						spec,
						normalizedOptions.value,
					)
					return built.ok
						? CommandResult.completed([built.value])
						: CommandResult.failed(built.error)
				})()
	if (pkgSpecResult.status !== "completed") {
		printOutcome(pkgSpecResult)
		return
	}
	const pkgSpecs = pkgSpecResult.value

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

	const pending: Array<{
		alias: Alias
		declaration: ValidatedDeclaration
	}> = []
	const seenAliases = new Set<string>()

	for (const draft of pkgSpecs) {
		const alias = coerceAlias(draft.alias)
		if (!alias) {
			const message = `Invalid alias: ${draft.alias}`
			printOutcome(
				CommandResult.failed({
					field: "alias",
					message,
					source: "manual",
					type: "validation",
				}),
			)
			return
		}

		if (seenAliases.has(alias)) {
			const message = `Duplicate alias in selection: ${alias}`
			printOutcome(
				CommandResult.failed({
					field: "alias",
					message,
					source: "manual",
					type: "validation",
				}),
			)
			return
		}
		seenAliases.add(alias)

		const resolvedDeclaration = resolveDeclarationPath(
			draft.declaration,
			selection.manifestPath,
		)
		if (resolvedDeclaration.status !== "completed") {
			printOutcome(resolvedDeclaration)
			return
		}

		const validated = validateDeclaration(resolvedDeclaration.value)
		if (!validated.ok) {
			printOutcome(CommandResult.failed(validated.error))
			return
		}

		pending.push({ alias, declaration: validated.value })
	}

	let updated = selection.manifest
	const changedAliases: string[] = []
	const unchangedAliases: string[] = []

	for (const item of pending) {
		const current = getDependency(updated, item.alias)
		if (!areDependenciesEqual(current, item.declaration)) {
			updated = addDependency(updated, item.alias, item.declaration)
			changedAliases.push(String(item.alias))
		} else {
			unchangedAliases.push(String(item.alias))
		}
	}

	const changed = changedAliases.length > 0
	let manifestForSync = selection.manifest

	if (changed) {
		const saved = await saveManifest(
			updated,
			selection.manifestPath,
			selection.serializeOptions,
		)
		if (!saved.ok) {
			printOutcome(CommandResult.failed(saved.error))
			return
		}
		manifestForSync = updated
	}

	const aliasList = pending.map((item) => String(item.alias)).join(", ")
	const noChangeReason =
		pending.length === 1
			? `Dependency already present: ${aliasList}. Manifest: ${selection.manifestPath} (no changes).`
			: `Dependencies already present: ${aliasList}. Manifest: ${selection.manifestPath} (no changes).`
	let outcome = CommandResult.completed(undefined)

	if (!changed && !options.sync) {
		outcome = CommandResult.unchanged(noChangeReason)
	}

	if (changed) {
		consola.success("Dependency settings updated.")
		if (selection.created) {
			consola.info(`Created ${selection.manifestPath}.`)
		}
		const addedLabel =
			changedAliases.length === 1 ? "Added dependency" : "Added dependencies"
		consola.success(`${addedLabel}: ${changedAliases.join(", ")}.`)
		consola.info(`Manifest: ${selection.manifestPath} (updated).`)
	} else if (options.sync) {
		const unchangedLabel =
			pending.length === 1
				? "Dependency already present"
				: "Dependencies already present"
		consola.info(`${unchangedLabel}: ${aliasList}.`)
		consola.info(`Manifest: ${selection.manifestPath} (no changes).`)
	}

	if (options.sync) {
		const syncResult = await syncWithSelection(
			{ ...selection, manifest: manifestForSync },
			{ dryRun: false, nonInteractive: options.nonInteractive },
		)
		if (syncResult.status === "failed") {
			printOutcome(syncResult)
			return
		}
		if (syncResult.status === "cancelled") {
			consola.info("Sync skipped.")
		} else if (syncResult.status === "unchanged") {
			consola.info(syncResult.reason)
		}
	}

	printOutcome(outcome)
}

export async function resolveAutoDetectSpec(
	input: string,
	options: NormalizedAddOptions,
	commandOptions: PkgAddCommandOptions,
): Promise<CommandResult<DependencyDraft[]>> {
	const trimmed = input.trim()
	if (!trimmed) {
		const message = "Package type or URL is required."
		return CommandResult.failed({
			field: "spec",
			message,
			source: "manual",
			type: "validation",
		})
	}

	if (!isAutoDetectUrl(trimmed)) {
		const message = "Package spec is required."
		return CommandResult.failed({
			field: "spec",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const remoteMarketplace = coerceRemoteMarketplaceUrl(trimmed)
	if (remoteMarketplace) {
		return resolveRemoteMarketplaceSpec(remoteMarketplace, options, commandOptions)
	}

	const ref = options.ref ? coerceGitRef(options.ref) : null
	if (options.ref && !ref) {
		const message = "Invalid git ref options."
		return CommandResult.failed({
			field: "ref",
			message,
			source: "manual",
			type: "validation",
		})
	}

	consola.info("Cloning repository...")
	const detected = await autoDetectPackage(trimmed, {
		path: options.path,
		ref: ref ?? undefined,
	})
	if (!detected.ok) {
		return CommandResult.failed(detected.error)
	}

	const detection = detected.value.detection
	if (detection.method === "claude-plugin") {
		if (options.ref) {
			const message = "--tag/--branch/--rev are not valid for marketplace plugins."
			return CommandResult.failed({
				field: "ref",
				message,
				source: "manual",
				type: "validation",
			})
		}
		if (options.path) {
			consola.info(
				"Note: --path is used for detection only; marketplace plugins do not support subpaths.",
			)
		}
		const marketplaceSpec = formatMarketplaceSpec(detected.value.source)
		const pluginOptions: NormalizedAddOptions = {
			aliasOverride: options.aliasOverride,
		}
		const spec = `${detection.pluginName}@${marketplaceSpec}`
		return buildSpecResult("claude-plugin", spec, pluginOptions)
	}

	if (detection.method === "marketplace") {
		if (options.ref) {
			const message = "--tag/--branch/--rev are not valid for marketplace plugins."
			return CommandResult.failed({
				field: "ref",
				message,
				source: "manual",
				type: "validation",
			})
		}
		if (options.path) {
			consola.info(
				"Note: --path is used for detection only; marketplace plugins do not support subpaths.",
			)
		}

		const pluginOptions: NormalizedAddOptions = {
			aliasOverride: options.aliasOverride,
		}
		const pluginResult = await selectMarketplacePlugins(
			detection.marketplace,
			commandOptions.nonInteractive,
		)
		if (pluginResult.status !== "completed") {
			return pluginResult
		}
		if (pluginOptions.aliasOverride && pluginResult.value.length > 1) {
			const message =
				"Alias override cannot be used when selecting multiple plugins."
			return CommandResult.failed({
				field: "alias",
				message,
				source: "manual",
				type: "validation",
			})
		}
		const marketplaceSpec = formatMarketplaceSpec(detected.value.source)
		const specs = pluginResult.value.map((plugin) => `${plugin}@${marketplaceSpec}`)
		return buildSpecResults("claude-plugin", specs, pluginOptions)
	}

	if (detection.method === "plugin-mismatch") {
		if (commandOptions.nonInteractive) {
			const message =
				"Detected a plugin that is not listed in the marketplace. Run interactively to choose how to add it."
			return CommandResult.failed({
				field: "marketplace",
				message,
				source: "manual",
				type: "validation",
			})
		}

		const action = await select({
			message: `Plugin "${detection.pluginName}" is not listed in the marketplace. How should it be added?`,
			options: [
				{ label: "Select plugin from marketplace", value: "marketplace" },
				{ label: "Add as GitHub/Git package", value: "package" },
				{ label: "Specify a different marketplace", value: "external" },
			],
		})

		if (isCancel(action)) {
			return CommandResult.cancelled()
		}

		if (action === "marketplace") {
			if (options.ref) {
				const message =
					"--tag/--branch/--rev are not valid for marketplace plugins."
				return CommandResult.failed({
					field: "ref",
					message,
					source: "manual",
					type: "validation",
				})
			}
			if (options.path) {
				consola.info(
					"Note: --path is used for detection only; marketplace plugins do not support subpaths.",
				)
			}

			const pluginOptions: NormalizedAddOptions = {
				aliasOverride: options.aliasOverride,
			}
			const pluginResult = await selectMarketplacePlugins(
				detection.marketplace,
				commandOptions.nonInteractive,
			)
			if (pluginResult.status !== "completed") {
				return pluginResult
			}
			if (pluginOptions.aliasOverride && pluginResult.value.length > 1) {
				const message =
					"Alias override cannot be used when selecting multiple plugins."
				return CommandResult.failed({
					field: "alias",
					message,
					source: "manual",
					type: "validation",
				})
			}
			const marketplaceSpec = formatMarketplaceSpec(detected.value.source)
			const specs = pluginResult.value.map(
				(plugin) => `${plugin}@${marketplaceSpec}`,
			)
			return buildSpecResults("claude-plugin", specs, pluginOptions)
		}

		if (action === "package") {
			const spec = formatMarketplaceSpec(detected.value.source)
			const type = formatSourceType(detected.value.source)
			const label = type === "github" ? "GitHub" : type === "git" ? "Git" : "local"
			consola.info(`Adding as a ${label} package.`)
			return buildSpecResult(type, spec, options)
		}

		if (action === "external") {
			if (options.ref) {
				const message =
					"--tag/--branch/--rev are not valid for marketplace plugins."
				return CommandResult.failed({
					field: "ref",
					message,
					source: "manual",
					type: "validation",
				})
			}
			if (options.path) {
				consola.info(
					"Note: --path is used for detection only; marketplace plugins do not support subpaths.",
				)
			}

			const marketplaceSpec = await text({
				message: "Enter the marketplace (owner/repo or git URL)",
				placeholder: "owner/repo",
			})

			if (isCancel(marketplaceSpec)) {
				return CommandResult.cancelled()
			}

			const trimmedMarketplace =
				typeof marketplaceSpec === "string" ? marketplaceSpec.trim() : ""
			if (!trimmedMarketplace) {
				const message = "Marketplace spec must not be empty."
				return CommandResult.failed({
					field: "marketplace",
					message,
					source: "manual",
					type: "validation",
				})
			}

			const pluginOptions: NormalizedAddOptions = {
				aliasOverride: options.aliasOverride,
			}
			const spec = `${detection.pluginName}@${trimmedMarketplace}`
			return buildSpecResult("claude-plugin", spec, pluginOptions)
		}
	}

	if (detection.method === "plugin") {
		if (commandOptions.nonInteractive) {
			const message =
				"Detected a plugin without a marketplace. Run interactively to choose how to add it."
			return CommandResult.failed({
				field: "marketplace",
				message,
				source: "manual",
				type: "validation",
			})
		}

		const action = await select({
			message: "Plugin detected without a marketplace. How should it be added?",
			options: [
				{ label: "Add as GitHub/Git package", value: "package" },
				{ label: "Specify a marketplace", value: "marketplace" },
			],
		})

		if (isCancel(action)) {
			return CommandResult.cancelled()
		}

		if (action === "marketplace") {
			if (options.ref) {
				const message =
					"--tag/--branch/--rev are not valid for marketplace plugins."
				return CommandResult.failed({
					field: "ref",
					message,
					source: "manual",
					type: "validation",
				})
			}
			if (options.path) {
				consola.info(
					"Note: --path is used for detection only; marketplace plugins do not support subpaths.",
				)
			}

			const marketplaceSpec = await text({
				message: "Enter the marketplace (owner/repo or git URL)",
				placeholder: "owner/repo",
			})

			if (isCancel(marketplaceSpec)) {
				return CommandResult.cancelled()
			}

			const trimmedMarketplace =
				typeof marketplaceSpec === "string" ? marketplaceSpec.trim() : ""
			if (!trimmedMarketplace) {
				const message = "Marketplace spec must not be empty."
				return CommandResult.failed({
					field: "marketplace",
					message,
					source: "manual",
					type: "validation",
				})
			}

			const pluginOptions: NormalizedAddOptions = {
				aliasOverride: options.aliasOverride,
			}
			const spec = `${detection.pluginName}@${trimmedMarketplace}`
			return buildSpecResult("claude-plugin", spec, pluginOptions)
		}
	}

	let type: string
	let spec: string
	switch (detected.value.source.type) {
		case "github":
			type = "github"
			spec = detected.value.source.slug
			break
		case "git":
			type = "git"
			spec = detected.value.source.url
			break
		case "local":
			type = "local"
			spec = detected.value.source.path
			break
	}
	consola.info(`Detected ${detection.method} package.`)
	return buildSpecResult(type, spec, options)
}

export async function resolveRemoteMarketplaceSpec(
	marketplaceUrl: string,
	options: NormalizedAddOptions,
	commandOptions: PkgAddCommandOptions,
): Promise<CommandResult<DependencyDraft[]>> {
	if (options.ref) {
		const message = "--tag/--branch/--rev are not valid for marketplace plugins."
		return CommandResult.failed({
			field: "ref",
			message,
			source: "manual",
			type: "validation",
		})
	}
	if (options.path) {
		const message = "--path is not valid for marketplace URLs."
		return CommandResult.failed({
			field: "path",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const contents = await fetchMarketplaceContents(marketplaceUrl)
	if (!contents.ok) {
		return CommandResult.failed(contents.error)
	}
	const parsed = parseMarketplace(contents.value)
	if (!parsed.ok) {
		return CommandResult.failed(parsed.error)
	}

	const pluginOptions: NormalizedAddOptions = {
		aliasOverride: options.aliasOverride,
	}
	const marketplaceInfo = {
		name: parsed.value.name,
		plugins: parsed.value.plugins.map((plugin) => plugin.name),
	}
	const pluginResult = await selectMarketplacePlugins(
		marketplaceInfo,
		commandOptions.nonInteractive,
	)
	if (pluginResult.status !== "completed") {
		return pluginResult
	}
	if (pluginOptions.aliasOverride && pluginResult.value.length > 1) {
		const message = "Alias override cannot be used when selecting multiple plugins."
		return CommandResult.failed({
			field: "alias",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const specs = pluginResult.value.map((plugin) => `${plugin}@${marketplaceUrl}`)
	return buildSpecResults("claude-plugin", specs, pluginOptions)
}

async function fetchMarketplaceContents(
	url: string,
): Promise<{ ok: true; value: string } | { ok: false; error: NetworkError }> {
	let response: Response
	try {
		response = await fetch(url)
	} catch (error) {
		return {
			error: {
				message: "Unable to fetch marketplace URL.",
				rawError: error instanceof Error ? error : undefined,
				source: url,
				type: "network",
			},
			ok: false,
		}
	}

	if (!response.ok) {
		return {
			error: {
				message: `Marketplace request failed (${response.status} ${response.statusText}).`,
				source: url,
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	return { ok: true, value: await response.text() }
}

async function selectMarketplacePlugins(
	marketplace: {
		name: string
		plugins: string[]
	},
	nonInteractive: boolean,
): Promise<CommandResult<string[]>> {
	if (marketplace.plugins.length === 0) {
		const message = `Marketplace "${marketplace.name}" has no plugins.`
		return CommandResult.failed({
			field: "plugins",
			message,
			source: "manual",
			type: "validation",
		})
	}

	if (marketplace.plugins.length === 1) {
		const [plugin] = marketplace.plugins
		if (!plugin) {
			const message = `Marketplace "${marketplace.name}" has no plugins.`
			return CommandResult.failed({
				field: "plugins",
				message,
				source: "manual",
				type: "validation",
			})
		}
		consola.info(`Detected marketplace with 1 plugin: "${plugin}".`)
		consola.info(`Auto-selecting plugin: ${plugin}`)
		return CommandResult.completed([plugin])
	}

	consola.info(`Detected marketplace with ${marketplace.plugins.length} plugins.`)

	if (nonInteractive) {
		const message =
			"Marketplace has multiple plugins. Run interactively to select which plugin to install."
		return CommandResult.failed({
			field: "plugins",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const selection = await multiselect({
		message: "Select plugin(s) to add",
		options: marketplace.plugins.map((plugin) => ({
			label: plugin,
			value: plugin,
		})),
		required: true,
	})

	if (isCancel(selection)) {
		return CommandResult.cancelled()
	}

	if (!Array.isArray(selection) || selection.length === 0) {
		const message = "Invalid plugin selection."
		return CommandResult.failed({
			field: "plugin",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const plugins = selection.filter(
		(value): value is string => typeof value === "string",
	)
	if (plugins.length === 0) {
		const message = "Invalid plugin selection."
		return CommandResult.failed({
			field: "plugin",
			message,
			source: "manual",
			type: "validation",
		})
	}

	return CommandResult.completed(plugins)
}

function areDependenciesEqual(
	current: ValidatedDeclaration | undefined,
	next: ValidatedDeclaration,
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

function buildSpecResult(
	type: string,
	spec: string,
	options: NormalizedAddOptions,
): CommandResult<DependencyDraft[]> {
	return buildSpecResults(type, [spec], options)
}

function buildSpecResults(
	type: string,
	specs: string[],
	options: NormalizedAddOptions,
): CommandResult<DependencyDraft[]> {
	const drafts: DependencyDraft[] = []
	for (const spec of specs) {
		const built = buildPackageSpec(type, spec, options)
		if (!built.ok) {
			return CommandResult.failed(built.error)
		}
		drafts.push(built.value)
	}
	return CommandResult.completed(drafts)
}

function formatMarketplaceSpec(source: AutoDetectSource): string {
	switch (source.type) {
		case "github":
			return source.slug
		case "git":
			return source.url
		case "local":
			return source.path
	}
}

function formatSourceType(source: AutoDetectSource): "github" | "git" | "local" {
	switch (source.type) {
		case "github":
			return "github"
		case "git":
			return "git"
		case "local":
			return "local"
	}
}

function resolveDeclarationPath(
	declaration: DependencyDraft["declaration"],
	manifestPath: AbsolutePath,
): CommandResult<DependencyDraft["declaration"]> {
	if (
		typeof declaration === "object" &&
		declaration !== null &&
		"path" in declaration &&
		!("gh" in declaration) &&
		!("git" in declaration) &&
		!("type" in declaration)
	) {
		const resolved = coerceAbsolutePath(
			String(declaration.path),
			path.dirname(manifestPath),
		)
		if (!resolved) {
			const message = `Invalid local path: ${String(declaration.path)}`
			return CommandResult.failed({
				field: "path",
				message,
				source: "manual",
				type: "validation",
			})
		}
		return CommandResult.completed({ path: resolved })
	}

	return CommandResult.completed(declaration)
}
