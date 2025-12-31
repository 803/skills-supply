import type { Manifest, ValidatedDependency } from "@/src/core/manifest/types"
import type { AgentId, Alias } from "@/src/core/types/branded"

/**
 * Pure transformation functions for Manifest.
 * These return new Manifest instances - no mutation.
 */

/**
 * Add or update a dependency in the manifest.
 * Returns a new Manifest with the dependency added/updated.
 */
export function addDependency(
	manifest: Manifest,
	alias: Alias,
	dependency: ValidatedDependency,
): Manifest {
	const newDeps = new Map(manifest.dependencies)
	newDeps.set(alias, dependency)
	return { ...manifest, dependencies: newDeps }
}

/**
 * Remove a dependency from the manifest.
 * Returns a new Manifest with the dependency removed.
 */
export function removeDependency(manifest: Manifest, alias: Alias): Manifest {
	const newDeps = new Map(manifest.dependencies)
	newDeps.delete(alias)
	return { ...manifest, dependencies: newDeps }
}

/**
 * Set an agent's enabled state in the manifest.
 * Returns a new Manifest with the agent state updated.
 */
export function setAgent(
	manifest: Manifest,
	agentId: AgentId,
	enabled: boolean,
): Manifest {
	const newAgents = new Map(manifest.agents)
	newAgents.set(agentId, enabled)
	return { ...manifest, agents: newAgents }
}

/**
 * Check if the manifest has a dependency with the given alias.
 */
export function hasDependency(manifest: Manifest, alias: Alias): boolean {
	return manifest.dependencies.has(alias)
}

/**
 * Get a dependency by alias, or undefined if not found.
 */
export function getDependency(
	manifest: Manifest,
	alias: Alias,
): ValidatedDependency | undefined {
	return manifest.dependencies.get(alias)
}

/**
 * Get an agent's enabled state, or undefined if not set.
 */
export function getAgent(manifest: Manifest, agentId: AgentId): boolean | undefined {
	return manifest.agents.get(agentId)
}
