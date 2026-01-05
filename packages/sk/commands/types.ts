import type { BaseError } from "@skills-supply/core"
import { consola } from "consola"
import type { ZodError } from "zod"
import type { SkError } from "@/types/errors"

// CommandResult models user-facing flow outcomes; core operations keep { ok, value } results.
export type CommandResult<T = void> =
	| { status: "completed"; value: T }
	| { status: "unchanged"; reason: string }
	| { status: "cancelled" }
	| { status: "failed"; error: SkError }

export const CommandResult = {
	cancelled: (): CommandResult<never> => ({ status: "cancelled" }),
	completed: <T>(value: T): CommandResult<T> => ({ status: "completed", value }),
	failed: (error: SkError): CommandResult<never> => ({ error, status: "failed" }),
	unchanged: (reason: string): CommandResult<never> => ({
		reason,
		status: "unchanged",
	}),
} as const

export function printOutcome(result: CommandResult<unknown>): void {
	switch (result.status) {
		case "completed":
			consola.success("Done.")
			break
		case "unchanged":
			consola.info(result.reason)
			break
		case "cancelled":
			consola.info("Canceled.")
			break
		case "failed":
			consola.error(formatErrorChain(result.error))
			printRawErrors(result.error)
			process.exitCode = 1
			break
	}
}

export function formatErrorChain(error: BaseError): string {
	return formatErrorChainLines(error, 0).join("\n")
}

function formatErrorChainLines(error: BaseError, indent: number): string[] {
	const prefix = " ".repeat(indent)
	const detailParts = buildDetailParts(error)
	const details = detailParts.length ? ` (${detailParts.join(", ")})` : ""
	const lines = [`${prefix}[${error.type}] ${error.message}${details}`]

	const zodError = "zodError" in error ? error.zodError : undefined
	if (isZodError(zodError)) {
		lines.push(`${prefix}  Zod issues:`)
		for (const issue of zodError.issues) {
			const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "<root>"
			lines.push(`${prefix}  - ${pathLabel}: ${issue.message}`)
		}
	}

	if (error.cause) {
		lines.push(`${prefix}Caused by:`)
		lines.push(...formatErrorChainLines(error.cause, indent + 2))
	}

	return lines
}

function isZodError(value: unknown): value is ZodError {
	return (
		typeof value === "object" &&
		value !== null &&
		"issues" in value &&
		Array.isArray((value as { issues?: unknown }).issues)
	)
}

function printRawErrors(error: BaseError): void {
	if (error.rawError) {
		console.error(error.rawError)
	}
	if (error.cause) {
		printRawErrors(error.cause)
	}
}

function buildDetailParts(error: BaseError): string[] {
	const details: string[] = []
	if ("field" in error && typeof error.field === "string") {
		details.push(`field=${error.field}`)
	}
	if ("path" in error && typeof error.path === "string") {
		details.push(`path=${error.path}`)
	}
	if ("source" in error && typeof error.source === "string") {
		details.push(`source=${error.source}`)
	}
	if ("spec" in error && typeof error.spec === "string") {
		details.push(`spec=${error.spec}`)
	}
	if ("operation" in error && typeof error.operation === "string") {
		details.push(`operation=${error.operation}`)
	}
	if ("stage" in error && typeof error.stage === "string") {
		details.push(`stage=${error.stage}`)
	}
	if ("target" in error && typeof error.target === "string") {
		details.push(`target=${error.target}`)
	}
	if ("status" in error && typeof error.status === "number") {
		details.push(`status=${error.status}`)
	}
	if ("alias" in error && typeof error.alias === "string") {
		details.push(`alias=${error.alias}`)
	}
	if ("agentId" in error && typeof error.agentId === "string") {
		details.push(`agentId=${error.agentId}`)
	}
	if ("origin" in error && typeof error.origin === "object" && error.origin) {
		const origin = error.origin as { alias?: string }
		if (origin.alias) {
			details.push(`origin=${origin.alias}`)
		}
	}
	return details
}
