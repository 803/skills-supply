import { homedir } from "node:os"
import path from "node:path"
import { confirm, isCancel, select } from "@clack/prompts"
import type { AbsolutePath } from "@skills-supply/core"
import {
	coerceAbsolutePathDirect,
	MANIFEST_FILENAME,
	SK_GLOBAL_DIR,
} from "@skills-supply/core"
import { consola } from "consola"
import { CommandResult } from "@/commands/types"
import { ensureDir } from "@/io/fs"
import { findGlobalRoot, findProjectRoot } from "@/manifest/discover"
import { createEmptyManifest, loadManifest, saveManifest } from "@/manifest/fs"
import type { Manifest } from "@/manifest/types"
import type { SerializeOptions } from "@/manifest/write"
import type { ManifestDiscoveredAt } from "@/types/context"

export type ManifestScope = "local" | "global"

export interface ParentPromptConfig {
	buildMessage: (projectRoot: AbsolutePath, cwd: AbsolutePath) => string
}

export type ParentPromptAction = "sync" | "modify"

export interface ParentPromptMessageOptions {
	action: ParentPromptAction
	warnAboutSkillVisibility?: boolean
}

/**
 * Build a consistent parent prompt message for when a manifest is found
 * in a parent directory rather than the current directory.
 */
export function buildParentPromptMessage(
	projectRoot: AbsolutePath,
	cwd: AbsolutePath,
	options: ParentPromptMessageOptions,
): string {
	const lines = [`Warning: Found ${MANIFEST_FILENAME} at ${projectRoot}.`]

	if (options.action === "sync") {
		lines.push(`Skills will install under ${projectRoot}.`)
	} else {
		lines.push(`This will modify ${projectRoot}/${MANIFEST_FILENAME}.`)
	}

	if (options.warnAboutSkillVisibility) {
		lines.push(`Note: Running agents from ${cwd} will not see those skills.`)
	}

	return lines.join("\n")
}

export interface ManifestSelection {
	created: boolean
	discoveredAt: ManifestDiscoveredAt
	manifest: Manifest
	manifestPath: AbsolutePath
	scope: ManifestScope
	scopeRoot: AbsolutePath
	serializeOptions: SerializeOptions
	usedParent: boolean
}

export interface LocalManifestOptions {
	cwd?: string
	createIfMissing: boolean
	nonInteractive: boolean
	parentPrompt?: ParentPromptConfig
	promptToCreate: boolean
}

export interface GlobalManifestOptions {
	createIfMissing: boolean
	nonInteractive: boolean
	promptToCreate: boolean
}

const EMPTY_MANIFEST_OPTIONS: SerializeOptions = {
	includeEmptyAgents: true,
	includeEmptyDependencies: true,
}

/**
 * Infer serialize options from a loaded manifest.
 * When sections are empty, we preserve them to avoid unexpectedly dropping
 * sections that existed in the original file.
 */
function inferSerializeOptions(manifest: Manifest): SerializeOptions {
	return {
		includeEmptyAgents: manifest.agents.size === 0,
		includeEmptyDependencies: manifest.dependencies.size === 0,
	}
}

export async function resolveLocalManifest(
	options: LocalManifestOptions,
): Promise<CommandResult<ManifestSelection>> {
	const cwd = coerceAbsolutePathDirect(options.cwd ?? process.cwd())
	if (!cwd) {
		const message = "Unable to resolve current working directory."
		return CommandResult.failed({
			field: "cwd",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const rootResult = await findProjectRoot(cwd)
	if (!rootResult.ok) {
		return CommandResult.failed(rootResult.error)
	}

	if (!rootResult.value) {
		return await resolveMissingLocalManifest(cwd, options)
	}

	const projectRoot = rootResult.value
	const manifestPath = path.join(projectRoot, MANIFEST_FILENAME) as AbsolutePath
	const discoveredAt: ManifestDiscoveredAt = projectRoot === cwd ? "cwd" : "parent"

	if (projectRoot !== cwd) {
		if (!options.nonInteractive && options.parentPrompt) {
			const message = options.parentPrompt.buildMessage(projectRoot, cwd)
			const decision = await selectParentManifest(message)
			if (decision === "cancel") {
				return CommandResult.cancelled()
			}
			if (decision === "create") {
				const selection = await createManifestSelection({
					discoveredAt: "cwd",
					manifestPath: path.join(cwd, MANIFEST_FILENAME) as AbsolutePath,
					scope: "local",
					scopeRoot: cwd,
					usedParent: false,
				})
				return selection
			}
		}
	}

	const loaded = await loadManifest(manifestPath, discoveredAt)
	if (!loaded.ok) {
		return CommandResult.failed(loaded.error)
	}
	return CommandResult.completed({
		created: false,
		discoveredAt,
		manifest: loaded.value.manifest,
		manifestPath,
		scope: "local",
		scopeRoot: projectRoot,
		serializeOptions: inferSerializeOptions(loaded.value.manifest),
		usedParent: projectRoot !== cwd,
	})
}

export async function resolveGlobalManifest(
	options: GlobalManifestOptions,
): Promise<CommandResult<ManifestSelection>> {
	const homeDir = coerceAbsolutePathDirect(homedir())
	if (!homeDir) {
		const message = "Unable to resolve home directory."
		return CommandResult.failed({
			field: "home",
			message,
			source: "manual",
			type: "validation",
		})
	}

	const rootResult = await findGlobalRoot()
	if (!rootResult.ok) {
		return CommandResult.failed(rootResult.error)
	}

	const globalPath = path.join(
		homeDir,
		SK_GLOBAL_DIR,
		MANIFEST_FILENAME,
	) as AbsolutePath
	if (!rootResult.value) {
		return await resolveMissingGlobalManifest(globalPath, homeDir, options)
	}

	const manifestPath = path.join(rootResult.value, MANIFEST_FILENAME) as AbsolutePath
	const loaded = await loadManifest(manifestPath, "sk-global")
	if (!loaded.ok) {
		return CommandResult.failed(loaded.error)
	}
	return CommandResult.completed({
		created: false,
		discoveredAt: "sk-global",
		manifest: loaded.value.manifest,
		manifestPath,
		scope: "global",
		scopeRoot: homeDir,
		serializeOptions: inferSerializeOptions(loaded.value.manifest),
		usedParent: false,
	})
}

/**
 * Warn users when operating in a subdirectory that skills will install
 * under the parent directory's manifest location.
 */
export function warnIfSubdirectory(selection: ManifestSelection): void {
	if (selection.scope !== "local" || !selection.usedParent) {
		return
	}

	consola.warn(
		`Skills will install under ${selection.scopeRoot}. Run agents from that directory to use them.`,
	)
}

async function resolveMissingLocalManifest(
	cwd: AbsolutePath,
	options: LocalManifestOptions,
): Promise<CommandResult<ManifestSelection>> {
	if (options.createIfMissing) {
		return await createManifestSelection({
			discoveredAt: "cwd",
			manifestPath: path.join(cwd, MANIFEST_FILENAME) as AbsolutePath,
			scope: "local",
			scopeRoot: cwd,
			usedParent: false,
		})
	}

	if (options.nonInteractive) {
		return CommandResult.failed({
			message: `No ${MANIFEST_FILENAME} found.`,
			path: path.join(cwd, MANIFEST_FILENAME) as AbsolutePath,
			target: "manifest",
			type: "not_found",
		})
	}

	if (!options.promptToCreate) {
		return CommandResult.failed({
			message: `No ${MANIFEST_FILENAME} found.`,
			path: path.join(cwd, MANIFEST_FILENAME) as AbsolutePath,
			target: "manifest",
			type: "not_found",
		})
	}

	const shouldCreate = await confirm({
		initialValue: false,
		message: `No ${MANIFEST_FILENAME} found. Create one here?`,
	})
	if (isCancel(shouldCreate) || !shouldCreate) {
		return CommandResult.cancelled()
	}

	return await createManifestSelection({
		discoveredAt: "cwd",
		manifestPath: path.join(cwd, MANIFEST_FILENAME) as AbsolutePath,
		scope: "local",
		scopeRoot: cwd,
		usedParent: false,
	})
}

async function resolveMissingGlobalManifest(
	manifestPath: AbsolutePath,
	homeDir: AbsolutePath,
	options: GlobalManifestOptions,
): Promise<CommandResult<ManifestSelection>> {
	if (options.createIfMissing) {
		return await createManifestSelection({
			discoveredAt: "sk-global",
			manifestPath,
			scope: "global",
			scopeRoot: homeDir,
			usedParent: false,
		})
	}

	if (options.nonInteractive) {
		return CommandResult.failed({
			message: "Global manifest not found.",
			path: manifestPath,
			target: "manifest",
			type: "not_found",
		})
	}

	if (!options.promptToCreate) {
		return CommandResult.failed({
			message: "Global manifest not found.",
			path: manifestPath,
			target: "manifest",
			type: "not_found",
		})
	}

	const shouldCreate = await confirm({
		initialValue: false,
		message: `No global ${MANIFEST_FILENAME} found. Create ~/${SK_GLOBAL_DIR}/${MANIFEST_FILENAME}?`,
	})
	if (isCancel(shouldCreate) || !shouldCreate) {
		return CommandResult.cancelled()
	}

	return await createManifestSelection({
		discoveredAt: "sk-global",
		manifestPath,
		scope: "global",
		scopeRoot: homeDir,
		usedParent: false,
	})
}

async function selectParentManifest(
	message: string,
): Promise<"parent" | "create" | "cancel"> {
	const decision = await select({
		initialValue: "cancel",
		message,
		options: [
			{ label: "Continue with parent manifest", value: "parent" },
			{ label: `Create new ${MANIFEST_FILENAME} here instead`, value: "create" },
			{ label: "Cancel", value: "cancel" },
		],
	})

	if (isCancel(decision)) {
		return "cancel"
	}

	return decision as "parent" | "create" | "cancel"
}

async function createManifestSelection(options: {
	discoveredAt: ManifestDiscoveredAt
	manifestPath: AbsolutePath
	scope: ManifestScope
	scopeRoot: AbsolutePath
	usedParent: boolean
}): Promise<CommandResult<ManifestSelection>> {
	const ensured = await ensureDir(path.dirname(options.manifestPath))
	if (!ensured.ok) {
		return CommandResult.failed(ensured.error)
	}
	const manifest = createEmptyManifest(options.manifestPath, options.discoveredAt)
	const saved = await saveManifest(
		manifest,
		options.manifestPath,
		EMPTY_MANIFEST_OPTIONS,
	)
	if (!saved.ok) {
		return CommandResult.failed(saved.error)
	}
	return CommandResult.completed({
		created: true,
		discoveredAt: options.discoveredAt,
		manifest,
		manifestPath: options.manifestPath,
		scope: options.scope,
		scopeRoot: options.scopeRoot,
		serializeOptions: EMPTY_MANIFEST_OPTIONS,
		usedParent: options.usedParent,
	})
}
