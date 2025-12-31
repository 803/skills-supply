import { homedir } from "node:os"
import path from "node:path"
import { confirm, isCancel, select } from "@clack/prompts"
import { consola } from "consola"
import { ensureDir } from "@/src/core/io/fs"
import { findGlobalRoot, findProjectRoot } from "@/src/core/manifest/discover"
import { createEmptyManifest, loadManifest, saveManifest } from "@/src/core/manifest/fs"
import type { Manifest } from "@/src/core/manifest/types"
import type { SerializeOptions } from "@/src/core/manifest/write"
import type { AbsolutePath, ManifestDiscoveredAt } from "@/src/core/types/branded"
import { coerceAbsolutePathDirect } from "@/src/core/types/coerce"

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
	const lines = [`Warning: Found package.toml at ${projectRoot}.`]

	if (options.action === "sync") {
		lines.push(`Skills will install under ${projectRoot}.`)
	} else {
		lines.push(`This will modify ${projectRoot}/package.toml.`)
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
): Promise<ManifestSelection> {
	const cwd = coerceAbsolutePathDirect(options.cwd ?? process.cwd())
	if (!cwd) {
		throw new Error("Unable to resolve current working directory.")
	}

	const rootResult = await findProjectRoot(cwd)
	if (!rootResult.ok) {
		throw new Error(rootResult.error.message)
	}

	if (!rootResult.value) {
		return await resolveMissingLocalManifest(cwd, options)
	}

	const projectRoot = rootResult.value
	const manifestPath = path.join(projectRoot, "package.toml") as AbsolutePath
	const discoveredAt: ManifestDiscoveredAt = projectRoot === cwd ? "cwd" : "parent"

	if (projectRoot !== cwd) {
		if (!options.nonInteractive && options.parentPrompt) {
			const message = options.parentPrompt.buildMessage(projectRoot, cwd)
			const decision = await selectParentManifest(message)
			if (decision === "cancel") {
				throw new Error("Canceled.")
			}
			if (decision === "create") {
				return await createManifestSelection({
					discoveredAt: "cwd",
					manifestPath: path.join(cwd, "package.toml") as AbsolutePath,
					scope: "local",
					scopeRoot: cwd,
					usedParent: false,
				})
			}
		}
	}

	const loaded = await loadManifest(manifestPath, discoveredAt)
	return {
		created: false,
		discoveredAt,
		manifest: loaded.manifest,
		manifestPath,
		scope: "local",
		scopeRoot: projectRoot,
		serializeOptions: inferSerializeOptions(loaded.manifest),
		usedParent: projectRoot !== cwd,
	}
}

export async function resolveGlobalManifest(
	options: GlobalManifestOptions,
): Promise<ManifestSelection> {
	const homeDir = coerceAbsolutePathDirect(homedir())
	if (!homeDir) {
		throw new Error("Unable to resolve home directory.")
	}

	const rootResult = await findGlobalRoot()
	if (!rootResult.ok) {
		throw new Error(rootResult.error.message)
	}

	const globalPath = path.join(homeDir, ".sk", "package.toml") as AbsolutePath
	if (!rootResult.value) {
		return await resolveMissingGlobalManifest(globalPath, homeDir, options)
	}

	const manifestPath = path.join(rootResult.value, "package.toml") as AbsolutePath
	const loaded = await loadManifest(manifestPath, "sk-global")
	return {
		created: false,
		discoveredAt: "sk-global",
		manifest: loaded.manifest,
		manifestPath,
		scope: "global",
		scopeRoot: homeDir,
		serializeOptions: inferSerializeOptions(loaded.manifest),
		usedParent: false,
	}
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
): Promise<ManifestSelection> {
	if (options.createIfMissing) {
		return await createManifestSelection({
			discoveredAt: "cwd",
			manifestPath: path.join(cwd, "package.toml") as AbsolutePath,
			scope: "local",
			scopeRoot: cwd,
			usedParent: false,
		})
	}

	if (options.nonInteractive) {
		throw new Error("No package.toml found.")
	}

	if (!options.promptToCreate) {
		throw new Error("No package.toml found.")
	}

	const shouldCreate = await confirm({
		initialValue: false,
		message: "No package.toml found. Create one here?",
	})
	if (isCancel(shouldCreate) || !shouldCreate) {
		throw new Error("Canceled.")
	}

	return await createManifestSelection({
		discoveredAt: "cwd",
		manifestPath: path.join(cwd, "package.toml") as AbsolutePath,
		scope: "local",
		scopeRoot: cwd,
		usedParent: false,
	})
}

async function resolveMissingGlobalManifest(
	manifestPath: AbsolutePath,
	homeDir: AbsolutePath,
	options: GlobalManifestOptions,
): Promise<ManifestSelection> {
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
		throw new Error("Global manifest not found.")
	}

	if (!options.promptToCreate) {
		throw new Error("Global manifest not found.")
	}

	const shouldCreate = await confirm({
		initialValue: false,
		message: "No global package.toml found. Create ~/.sk/package.toml?",
	})
	if (isCancel(shouldCreate) || !shouldCreate) {
		throw new Error("Canceled.")
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
			{ label: "Create new package.toml here instead", value: "create" },
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
}): Promise<ManifestSelection> {
	const ensured = await ensureDir(path.dirname(options.manifestPath))
	if (!ensured.ok) {
		throw new Error(ensured.error.message)
	}
	const manifest = createEmptyManifest(options.manifestPath, options.discoveredAt)
	await saveManifest(manifest, options.manifestPath, EMPTY_MANIFEST_OPTIONS)
	return {
		created: true,
		discoveredAt: options.discoveredAt,
		manifest,
		manifestPath: options.manifestPath,
		scope: options.scope,
		scopeRoot: options.scopeRoot,
		serializeOptions: EMPTY_MANIFEST_OPTIONS,
		usedParent: options.usedParent,
	}
}
