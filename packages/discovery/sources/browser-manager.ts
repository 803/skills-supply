import type { Result } from "@skills-supply/core"
import { consola } from "consola"
import { type Browser, chromium, type Page } from "playwright-core"
import type { DiscoveryError } from "@/types/errors"

const SKILLSMP_ORIGIN = "https://skillsmp.com"

/**
 * Manages browser lifecycle for Browserless CDP connections.
 *
 * Responsibilities:
 * - Lazy browser creation (only connects when getPage() called)
 * - Staleness detection (isConnected, isClosed, disconnect event)
 * - On-demand recreation when browser dies
 *
 * This is a boundary component - it transforms wsEndpoint into Page objects
 * and handles all connection lifecycle complexity so core scraping logic
 * can simply call getPage() and assume a working Page.
 */
export class BrowserManager {
	private browser: Browser | null = null
	private page: Page | null = null

	constructor(private sessionFactory: () => Promise<Result<string, DiscoveryError>>) {}

	/**
	 * Get a working Page, creating or recreating the browser session as needed.
	 *
	 * Checks connection health before returning existing page.
	 * If browser is disconnected or page is closed, creates a new session.
	 */
	async getPage(): Promise<Result<Page, DiscoveryError>> {
		if (this.isHealthy()) {
			return { ok: true, value: this.page as Page }
		}

		consola.info("[browser-manager] Creating new browser session...")

		const result = await this.createSession()
		if (!result.ok) {
			return result
		}

		this.browser = result.value.browser
		this.page = result.value.page

		this.setupDisconnectHandler()

		consola.success("[browser-manager] Browser session ready")
		return { ok: true, value: this.page }
	}

	async close(): Promise<void> {
		if (this.browser) {
			try {
				await this.browser.close()
			} catch {
				// Ignore errors - browser may already be closed
			}
			this.browser = null
			this.page = null
		}
	}

	private isHealthy(): boolean {
		return Boolean(this.browser?.isConnected() && this.page && !this.page.isClosed())
	}

	private async createSession(): Promise<
		Result<{ browser: Browser; page: Page }, DiscoveryError>
	> {
		// Clean up any dead browser first
		await this.close()

		// Get fresh wsEndpoint from Browserless BQL
		const sessionResult = await this.sessionFactory()
		if (!sessionResult.ok) {
			return sessionResult
		}

		// Connect to browser via CDP
		let browser: Browser
		try {
			browser = await chromium.connectOverCDP(sessionResult.value)
		} catch (error) {
			return {
				error: {
					message: "Failed to connect to Browserless via CDP.",
					rawError: error instanceof Error ? error : undefined,
					source: sessionResult.value,
					type: "network",
				},
				ok: false,
			}
		}

		// Get or create page in existing context
		const context = browser.contexts()[0]
		if (!context) {
			await browser.close()
			return {
				error: {
					message: "Browserless session returned no browser contexts.",
					source: "browserless",
					type: "network",
				},
				ok: false,
			}
		}

		let page = context.pages()[0]
		if (!page) {
			page = await context.newPage()
		}

		// Navigate to origin if needed (for cookie context)
		if (!page.url().startsWith(SKILLSMP_ORIGIN)) {
			try {
				await page.goto(SKILLSMP_ORIGIN, { waitUntil: "domcontentloaded" })
			} catch (error) {
				await browser.close()
				return {
					error: {
						message: "SkillsMP navigation failed in Browserless session.",
						rawError: error instanceof Error ? error : undefined,
						source: SKILLSMP_ORIGIN,
						type: "network",
					},
					ok: false,
				}
			}
		}

		return { ok: true, value: { browser, page } }
	}

	private setupDisconnectHandler(): void {
		if (!this.browser) return

		this.browser.on("disconnected", () => {
			consola.warn("[browser-manager] Browser disconnected by remote")
			// Clear references so next getPage() creates fresh session
			this.browser = null
			this.page = null
		})
	}
}
