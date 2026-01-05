import type { BaseError } from "@skills-supply/core"
import { consola } from "consola"
import type { ZodError } from "zod"

type PrintableError = BaseError & {
	field?: string
	path?: string
	operation?: string
	status?: number
	source?: string
	target?: string
	zodError?: ZodError
}

export function formatErrorChain(error: PrintableError): string {
	return formatErrorChainLines(error, 0).join("\n")
}

export function printError(error: PrintableError): void {
	consola.error(formatErrorChain(error))
	printRawErrorChain(error)
	process.exitCode = 1
}

function formatErrorChainLines(error: PrintableError, indent: number): string[] {
	const prefix = " ".repeat(indent)
	const detailParts = buildDetailParts(error)
	const details = detailParts.length ? ` (${detailParts.join(", ")})` : ""
	const lines = [`${prefix}[${error.type}] ${error.message}${details}`]

	if (error.zodError) {
		lines.push(`${prefix}  Zod issues:`)
		for (const issue of error.zodError.issues) {
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

export function printRawErrorChain(error: PrintableError): void {
	if (error.rawError) {
		console.error(error.rawError)
	}
	if (error.cause) {
		printRawErrorChain(error.cause)
	}
}

function buildDetailParts(error: PrintableError): string[] {
	const details: string[] = []
	if ("field" in error && typeof error.field === "string") {
		details.push(`field=${error.field}`)
	}
	if ("path" in error && typeof error.path === "string") {
		details.push(`path=${error.path}`)
	}
	if ("operation" in error && typeof error.operation === "string") {
		details.push(`operation=${error.operation}`)
	}
	if ("status" in error && typeof error.status === "number") {
		details.push(`status=${error.status}`)
	}
	if ("source" in error && typeof error.source === "string") {
		details.push(`source=${error.source}`)
	}
	if ("target" in error && typeof error.target === "string") {
		details.push(`target=${error.target}`)
	}
	return details
}
