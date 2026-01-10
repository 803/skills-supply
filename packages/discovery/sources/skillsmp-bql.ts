import { readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { assertAbsolutePathDirect, type Result } from "@skills-supply/core"
import { consola } from "consola"
import type { Page } from "playwright-core"
import { env } from "@/env"
import { BrowserManager } from "@/sources/browser-manager"
import type { OnGithubRepoUrls } from "@/sources/types"
import type { DiscoveryError, IoError, ParseError, ValidationError } from "@/types/errors"

const BROWSERLESS_BQL_ENDPOINT = "https://production-sfo.browserless.io/chromium/bql"
const SKILLSMP_ORIGIN = "https://skillsmp.com"
const SKILLSMP_INTERNAL_PATH = "/api/skills"
const SKILLSMP_SEARCH_QUERY = "*"
const SKILLSMP_SORT_BY = "stars"
const SKILLSMP_DEFAULT_LIMIT = 48
const SKILLSMP_FETCH_TIMEOUT_MS = 30_000
const PAGE_JITTER_MAX_MS = 0

interface SkillsmpPagination {
	page: number
	limit: number
	total: number
	totalPages: number
	hasNext: boolean
	hasPrev: boolean
}

interface SkillsmpSkill {
	githubUrl?: string | null
}

interface SkillsmpInternalResponse {
	skills: SkillsmpSkill[]
	pagination: SkillsmpPagination
}

interface SkillsmpState {
	resumeFromPage: number
	totalPages: number
	startedAt: string
}

type SkillsmpStateError = IoError | ParseError | ValidationError

type SkillsmpStateResult<T> = Result<T, SkillsmpStateError>

const STATE_FILENAME = ".skillsmp-bql-state.json"

export async function discover(
	onGithubRepoUrls: OnGithubRepoUrls,
): Promise<Result<void, DiscoveryError>> {
	if (!env.BROWSERLESS_TOKEN) {
		return {
			error: {
				field: "BROWSERLESS_TOKEN",
				message: "BROWSERLESS_TOKEN is required for SkillsMP hybrid BQL.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const browserManager = new BrowserManager(startBrowserlessSession)

	const stateResult = await readState()
	if (!stateResult.ok) {
		await browserManager.close()
		return { error: stateResult.error, ok: false }
	}

	const existingState = stateResult.value
	const startedAt = existingState?.startedAt ?? new Date().toISOString()
	const limit = env.SKILLSMP_BQL_LIMIT ?? SKILLSMP_DEFAULT_LIMIT
	const timeoutMs = env.SKILLSMP_BQL_TIMEOUT_MS ?? SKILLSMP_FETCH_TIMEOUT_MS

	let currentPage = existingState?.resumeFromPage ?? 1
	let totalPages = existingState?.totalPages ?? null

	try {
		if (existingState) {
			consola.info(
				`Resuming SkillsMP BQL from page ${currentPage}/${totalPages ?? "?"}.`,
			)
		}

		let hasNext = true
		while (hasNext) {
			// Get a working page (creates or reuses browser session)
			const pageResult = await browserManager.getPage()
			if (!pageResult.ok) {
				return pageResult
			}

			const fetchResult = await fetchSkillsmpInternalPage(pageResult.value, {
				limit,
				page: currentPage,
				timeoutMs,
			})
			if (!fetchResult.ok) {
				const err = fetchResult.error
				if (err.type === "network" && err.retryable && err.retryAfterSeconds) {
					const waitMs = (err.retryAfterSeconds + 1) * 1000 // +1s buffer
					consola.info(`[skillsmp-bql] Waiting ${waitMs}ms before retry...`)
					await sleep(waitMs)
					continue // retry same page (browser may be recreated next iteration)
				}
				return fetchResult
			}

			totalPages = fetchResult.value.pagination.totalPages

			const urls = fetchResult.value.skills
				.map((skill) => skill.githubUrl)
				.filter((url): url is string => url !== null && url !== undefined)

			const control = await onGithubRepoUrls(urls)

			const writeResult = await writeState({
				resumeFromPage: currentPage + 1,
				startedAt,
				totalPages: totalPages ?? currentPage,
			})
			if (!writeResult.ok) {
				return { error: writeResult.error, ok: false }
			}

			if (control === "stop") {
				break
			}

			hasNext = fetchResult.value.pagination.hasNext
			currentPage += 1

			await sleep(randomDelayMs())
		}

		const clearResult = await clearState()
		if (!clearResult.ok) {
			return { error: clearResult.error, ok: false }
		}

		return { ok: true, value: undefined }
	} finally {
		await browserManager.close()
	}
}

async function startBrowserlessSession(): Promise<Result<string, DiscoveryError>> {
	const query = `
		mutation SkillsmpHybridBql {
			goto(url: "${SKILLSMP_ORIGIN}", waitUntil: networkIdle) {
				status
				time
			}
			solve {
				found
				solved
				time
			}
			waitForRequest(url: "**/api/skills*", method: GET, timeout: 30000) {
				time
			}
			reconnect(timeout: 10000) {
				browserWSEndpoint
			}
		}
	`

	const endpoint = new URL(BROWSERLESS_BQL_ENDPOINT)
	endpoint.searchParams.set("token", env.BROWSERLESS_TOKEN ?? "")

	let response: Response
	try {
		response = await fetch(endpoint.toString(), {
			body: JSON.stringify({ query }),
			headers: {
				"Content-Type": "application/json",
			},
			method: "POST",
		})
	} catch (error) {
		return {
			error: {
				message: "Browserless BQL request failed.",
				rawError: error instanceof Error ? error : undefined,
				source: endpoint.toString(),
				type: "network",
			},
			ok: false,
		}
	}

	if (!response.ok) {
		const text = await response.text()
		return {
			error: {
				message: `Browserless BQL request failed with status ${response.status}.`,
				rawError: new Error(text),
				source: endpoint.toString(),
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	let payload: BrowserlessReconnectResponse
	try {
		payload = (await response.json()) as BrowserlessReconnectResponse
	} catch (error) {
		return {
			error: {
				message: "Browserless BQL response parsing failed.",
				rawError: error instanceof Error ? error : undefined,
				source: endpoint.toString(),
				type: "parse",
			},
			ok: false,
		}
	}

	if (payload.errors?.length) {
		return {
			error: {
				message: payload.errors[0]?.message ?? "Browserless BQL returned errors.",
				source: endpoint.toString(),
				type: "network",
			},
			ok: false,
		}
	}

	const browserWSEndpoint = payload.data?.reconnect?.browserWSEndpoint
	if (!browserWSEndpoint) {
		return {
			error: {
				message: "Browserless reconnect returned no browser endpoint.",
				source: endpoint.toString(),
				type: "parse",
			},
			ok: false,
		}
	}

	if (payload.data?.solve) {
		consola.info("[skillsmp-bql] Browserless solve:", payload.data.solve)
	}

	return {
		ok: true,
		value: ensureBrowserlessToken(browserWSEndpoint, env.BROWSERLESS_TOKEN ?? ""),
	}
}

async function fetchSkillsmpInternalPage(
	page: Page,
	options: { page: number; limit: number; timeoutMs: number },
): Promise<Result<SkillsmpInternalResponse, DiscoveryError>> {
	let response: {
		ok: boolean
		status: number
		text: string
		url: string
		error?: string
		headers?: Record<string, string>
	}
	try {
		response = await page.evaluate(
			async ({
				endpointPath,
				pageNumber,
				limit,
				searchQuery,
				sortBy,
				timeoutMs,
			}) => {
				const controller = new AbortController()
				const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

				try {
					const url = new URL(endpointPath, window.location.origin)
					url.searchParams.set("page", String(pageNumber))
					url.searchParams.set("limit", String(limit))
					url.searchParams.set("search", searchQuery)
					url.searchParams.set("sortBy", sortBy)

					const res = await fetch(url.toString(), {
						signal: controller.signal,
					})
					const text = await res.text()

					// Capture relevant headers for rate limiting
					const headers: Record<string, string> = {}
					for (const key of [
						"retry-after",
						"x-ratelimit-limit",
						"x-ratelimit-remaining",
						"x-ratelimit-reset",
					]) {
						const value = res.headers.get(key)
						if (value) headers[key] = value
					}

					return {
						headers,
						ok: res.ok,
						status: res.status,
						text,
						url: url.toString(),
					}
				} catch (error) {
					return {
						error: error instanceof Error ? error.message : String(error),
						ok: false,
						status: 0,
						text: "",
						url: "",
					}
				} finally {
					window.clearTimeout(timeout)
				}
			},
			{
				endpointPath: SKILLSMP_INTERNAL_PATH,
				limit: options.limit,
				pageNumber: options.page,
				searchQuery: SKILLSMP_SEARCH_QUERY,
				sortBy: SKILLSMP_SORT_BY,
				timeoutMs: options.timeoutMs,
			},
		)
	} catch (error) {
		return {
			error: {
				message: "SkillsMP page evaluation failed.",
				rawError: error instanceof Error ? error : undefined,
				source: SKILLSMP_INTERNAL_PATH,
				type: "network",
			},
			ok: false,
		}
	}

	if (!response.ok) {
		if (response.status === 429) {
			const retryAfter = response.headers?.["retry-after"]
			const retryAfterSeconds = retryAfter
				? Number.parseInt(retryAfter, 10)
				: undefined
			consola.warn(
				`[skillsmp-bql] Rate limited (429), retry after ${retryAfterSeconds ?? "?"}s`,
			)
			return {
				error: {
					message: `SkillsMP rate limited (429). Retry after ${retryAfterSeconds ?? "?"}s.`,
					retryAfterSeconds: Number.isFinite(retryAfterSeconds)
						? retryAfterSeconds
						: undefined,
					retryable: true,
					source: response.url || SKILLSMP_INTERNAL_PATH,
					status: 429,
					type: "network",
				},
				ok: false,
			}
		}
		return {
			error: {
				message:
					response.status > 0
						? `SkillsMP request failed with status ${response.status}.`
						: `SkillsMP request failed: ${response.error ?? "unknown error"}.`,
				source: response.url || SKILLSMP_INTERNAL_PATH,
				status: response.status > 0 ? response.status : undefined,
				type: "network",
			},
			ok: false,
		}
	}

	let payload: unknown
	try {
		payload = JSON.parse(response.text)
	} catch (error) {
		return {
			error: {
				message: "SkillsMP response parsing failed.",
				rawError: error instanceof Error ? error : undefined,
				source: response.url || "skillsmp",
				type: "parse",
			},
			ok: false,
		}
	}

	return parseInternalResponse(payload)
}

function parseInternalResponse(
	payload: unknown,
): Result<SkillsmpInternalResponse, DiscoveryError> {
	if (typeof payload !== "object" || payload === null) {
		return {
			error: {
				message: "SkillsMP response was not an object.",
				source: "skillsmp",
				type: "parse",
			},
			ok: false,
		}
	}

	const skills = (payload as { skills?: unknown }).skills
	if (!Array.isArray(skills)) {
		return {
			error: {
				message: "SkillsMP response skills was not an array.",
				source: "skillsmp",
				type: "parse",
			},
			ok: false,
		}
	}

	const validatedSkills: SkillsmpSkill[] = []
	for (const skill of skills) {
		if (isSkillsmpSkill(skill)) {
			validatedSkills.push(skill)
		}
	}

	const pagination = (payload as { pagination?: unknown }).pagination
	if (!isSkillsmpPagination(pagination)) {
		return {
			error: {
				message: "SkillsMP response pagination was invalid.",
				source: "skillsmp",
				type: "parse",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			pagination,
			skills: validatedSkills,
		},
	}
}

function isSkillsmpSkill(value: unknown): value is SkillsmpSkill {
	if (typeof value !== "object" || value === null) {
		return false
	}
	const githubUrl = (value as { githubUrl?: unknown }).githubUrl
	if (githubUrl === undefined || githubUrl === null) {
		return true
	}
	return typeof githubUrl === "string"
}

function isSkillsmpPagination(value: unknown): value is SkillsmpPagination {
	if (typeof value !== "object" || value === null) {
		return false
	}

	const record = value as {
		page?: unknown
		limit?: unknown
		total?: unknown
		totalPages?: unknown
		hasNext?: unknown
		hasPrev?: unknown
	}

	return (
		isFiniteNumber(record.page) &&
		isFiniteNumber(record.limit) &&
		isFiniteNumber(record.total) &&
		isFiniteNumber(record.totalPages) &&
		typeof record.hasNext === "boolean" &&
		typeof record.hasPrev === "boolean"
	)
}

function ensureBrowserlessToken(endpoint: string, token: string): string {
	if (!token) {
		return endpoint
	}

	let url: URL
	try {
		url = new URL(endpoint)
	} catch {
		return endpoint
	}

	if (!url.searchParams.has("token")) {
		url.searchParams.set("token", token)
	}

	return url.toString()
}

function randomDelayMs(): number {
	return Math.floor(Math.random() * PAGE_JITTER_MAX_MS)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

function resolveStatePath(): string {
	return path.resolve(process.cwd(), STATE_FILENAME)
}

async function readState(): Promise<SkillsmpStateResult<SkillsmpState | null>> {
	const statePath = resolveStatePath()

	let contents: string
	try {
		contents = await readFile(statePath, "utf8")
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}
		return {
			error: {
				message: `Unable to read ${statePath}.`,
				operation: "readFile",
				path: assertAbsolutePathDirect(statePath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		return {
			error: {
				message: `Invalid JSON in ${statePath}.`,
				path: assertAbsolutePathDirect(statePath),
				rawError: error instanceof Error ? error : undefined,
				source: "skillsmp_bql_state",
				type: "parse",
			},
			ok: false,
		}
	}

	return parseState(parsed, statePath)
}

async function writeState(state: SkillsmpState): Promise<SkillsmpStateResult<void>> {
	const statePath = resolveStatePath()
	const output = JSON.stringify(state, null, 2)

	try {
		await writeFile(statePath, `${output}\n`)
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: `Unable to write ${statePath}.`,
				operation: "writeFile",
				path: assertAbsolutePathDirect(statePath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function clearState(): Promise<SkillsmpStateResult<void>> {
	const statePath = resolveStatePath()
	try {
		await rm(statePath)
		return { ok: true, value: undefined }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: undefined }
		}
		return {
			error: {
				message: `Unable to remove ${statePath}.`,
				operation: "rm",
				path: assertAbsolutePathDirect(statePath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

function parseState(raw: unknown, statePath: string): SkillsmpStateResult<SkillsmpState> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			error: {
				field: "state",
				message: "SkillsMP BQL state must be a JSON object.",
				path: assertAbsolutePathDirect(statePath),
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const resumeFromPage = (raw as { resumeFromPage?: unknown }).resumeFromPage
	if (!isPositiveInteger(resumeFromPage)) {
		return {
			error: {
				field: "resumeFromPage",
				message: "SkillsMP BQL state resumeFromPage must be a positive integer.",
				path: assertAbsolutePathDirect(statePath),
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const totalPages = (raw as { totalPages?: unknown }).totalPages
	if (!isPositiveInteger(totalPages)) {
		return {
			error: {
				field: "totalPages",
				message: "SkillsMP BQL state totalPages must be a positive integer.",
				path: assertAbsolutePathDirect(statePath),
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const startedAt = (raw as { startedAt?: unknown }).startedAt
	if (typeof startedAt !== "string" || startedAt.trim().length === 0) {
		return {
			error: {
				field: "startedAt",
				message: "SkillsMP BQL state startedAt must be a non-empty string.",
				path: assertAbsolutePathDirect(statePath),
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			resumeFromPage,
			startedAt,
			totalPages,
		},
	}
}

function isPositiveInteger(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		Number.isFinite(value) &&
		value > 0
	)
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}

interface BrowserlessReconnectResponse {
	data?: {
		goto?: { status: number; time: number }
		solve?: { found: boolean; solved: boolean; time: number }
		waitForNavigation?: { status: number; time: number }
		reconnect?: { browserWSEndpoint?: string }
	}
	errors?: Array<{ message: string }>
}
