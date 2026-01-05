import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import { parseAutoDetectUrl } from "@/packages/auto-detect"

function expectUrlValidation(
	result: ReturnType<typeof parseAutoDetectUrl>,
	message: string,
) {
	expect(result.ok).toBe(false)
	if (!result.ok) {
		expect(result.error.type).toBe("validation")
		if (result.error.type === "validation") {
			expect(result.error.source).toBe("manual")
			expect(result.error.field).toBe("url")
			expect(result.error.message).toBe(message)
		}
	}
}

describe("parseAutoDetectUrl", () => {
	describe("GitHub HTTPS URLs", () => {
		it("parses standard GitHub HTTPS URL", () => {
			expect(parseAutoDetectUrl("https://github.com/owner/repo")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})

		it("parses GitHub HTTPS URL with .git suffix", () => {
			expect(parseAutoDetectUrl("https://github.com/owner/repo.git")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})

		it("strips trailing slashes from GitHub HTTPS URLs", () => {
			expect(parseAutoDetectUrl("https://github.com/owner/repo/")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})

			expect(parseAutoDetectUrl("https://github.com/owner/repo///")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})

		it("trims whitespace from GitHub HTTPS URLs", () => {
			expect(parseAutoDetectUrl("  https://github.com/owner/repo  ")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})

		it("rejects GitHub URLs with extra path segments", () => {
			expectUrlValidation(
				parseAutoDetectUrl("https://github.com/owner/repo/tree/main"),
				"GitHub URLs must be in the form https://github.com/owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
			)

			expectUrlValidation(
				parseAutoDetectUrl("https://github.com/owner/repo/blob/main/file.ts"),
				"GitHub URLs must be in the form https://github.com/owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
			)
		})

		it("rejects GitHub URLs with only owner (missing repo)", () => {
			expectUrlValidation(
				parseAutoDetectUrl("https://github.com/owner"),
				"GitHub URLs must be in the form https://github.com/owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
			)
		})

		it("rejects GitHub URLs with no path", () => {
			expectUrlValidation(
				parseAutoDetectUrl("https://github.com"),
				"GitHub URLs must be in the form https://github.com/owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
			)

			expectUrlValidation(
				parseAutoDetectUrl("https://github.com/"),
				"GitHub URLs must be in the form https://github.com/owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
			)
		})
	})

	describe("GitHub SSH URLs", () => {
		it("parses standard GitHub SSH URL", () => {
			expect(parseAutoDetectUrl("git@github.com:owner/repo")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})

		it("parses GitHub SSH URL with .git suffix", () => {
			expect(parseAutoDetectUrl("git@github.com:owner/repo.git")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})

		it("trims whitespace from GitHub SSH URLs", () => {
			expect(parseAutoDetectUrl("  git@github.com:owner/repo  ")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})

		it("rejects GitHub SSH URLs with extra path segments", () => {
			expectUrlValidation(
				parseAutoDetectUrl("git@github.com:owner/repo/subdir"),
				"GitHub SSH URLs must be in the form git@github.com:owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
			)
		})

		it("rejects GitHub SSH URLs with only owner (missing repo)", () => {
			expectUrlValidation(
				parseAutoDetectUrl("git@github.com:owner"),
				"GitHub SSH URLs must be in the form git@github.com:owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
			)
		})
	})

	describe("non-GitHub HTTPS URLs", () => {
		it("parses GitLab HTTPS URL with .git suffix", () => {
			expect(parseAutoDetectUrl("https://gitlab.com/org/repo.git")).toEqual({
				ok: true,
				value: { type: "git", url: "https://gitlab.com/org/repo" },
			})
		})

		it("parses Bitbucket HTTPS URL with .git suffix", () => {
			expect(parseAutoDetectUrl("https://bitbucket.org/team/project.git")).toEqual({
				ok: true,
				value: { type: "git", url: "https://bitbucket.org/team/project" },
			})
		})

		it("parses self-hosted git HTTPS URL with .git suffix", () => {
			expect(
				parseAutoDetectUrl("https://git.example.com/path/to/repo.git"),
			).toEqual({
				ok: true,
				value: { type: "git", url: "https://git.example.com/path/to/repo" },
			})
		})

		it("rejects non-GitHub HTTPS URLs without .git suffix", () => {
			expectUrlValidation(
				parseAutoDetectUrl("https://gitlab.com/org/repo"),
				"Unsupported auto-detect target. Use owner/repo, a GitHub URL, git@host:path, https://host/repo.git, or a local path.",
			)
		})
	})

	describe("non-GitHub SSH URLs", () => {
		it("parses GitLab SSH URL", () => {
			expect(parseAutoDetectUrl("git@gitlab.com:org/repo")).toEqual({
				ok: true,
				value: { type: "git", url: "git@gitlab.com:org/repo" },
			})
		})

		it("parses GitLab SSH URL with .git suffix and strips it", () => {
			expect(parseAutoDetectUrl("git@gitlab.com:org/repo.git")).toEqual({
				ok: true,
				value: { type: "git", url: "git@gitlab.com:org/repo" },
			})
		})

		it("parses Bitbucket SSH URL", () => {
			expect(parseAutoDetectUrl("git@bitbucket.org:team/project.git")).toEqual({
				ok: true,
				value: { type: "git", url: "git@bitbucket.org:team/project" },
			})
		})

		it("parses self-hosted SSH URL with nested path", () => {
			expect(parseAutoDetectUrl("git@git.example.com:path/to/repo.git")).toEqual({
				ok: true,
				value: { type: "git", url: "git@git.example.com:path/to/repo" },
			})
		})
	})

	describe("invalid SSH URLs", () => {
		it("rejects malformed SSH URL without colon separator", () => {
			expectUrlValidation(
				parseAutoDetectUrl("git@github.com/owner/repo"),
				"Invalid git SSH URL: git@github.com/owner/repo",
			)
		})

		it("rejects SSH URL with empty path after colon", () => {
			expectUrlValidation(
				parseAutoDetectUrl("git@github.com:"),
				"Invalid git SSH URL: git@github.com:",
			)
		})

		it("rejects SSH URL with only .git after colon", () => {
			expectUrlValidation(
				parseAutoDetectUrl("git@github.com:.git"),
				"Invalid git SSH URL: git@github.com:.git",
			)
		})
	})

	describe("empty and whitespace input", () => {
		it("rejects empty string", () => {
			expectUrlValidation(
				parseAutoDetectUrl(""),
				"Target is required for auto-detect.",
			)
		})

		it("rejects whitespace-only string", () => {
			expectUrlValidation(
				parseAutoDetectUrl("   "),
				"Target is required for auto-detect.",
			)

			expectUrlValidation(
				parseAutoDetectUrl("\t\n"),
				"Target is required for auto-detect.",
			)
		})
	})

	describe("github shorthand", () => {
		it("parses owner/repo format", () => {
			expect(parseAutoDetectUrl("owner/repo")).toEqual({
				ok: true,
				value: { slug: "owner/repo", type: "github" },
			})
		})
	})

	describe("local paths", () => {
		it("parses absolute local paths", () => {
			expect(parseAutoDetectUrl("/tmp/my-skills")).toEqual({
				ok: true,
				value: { path: "/tmp/my-skills", type: "local" },
			})
		})

		it("parses relative local paths", () => {
			const original = process.cwd()
			try {
				process.chdir("/")
				expect(parseAutoDetectUrl("./my-skills")).toEqual({
					ok: true,
					value: { path: "/my-skills", type: "local" },
				})
				expect(parseAutoDetectUrl("../shared")).toEqual({
					ok: true,
					value: { path: "/shared", type: "local" },
				})
			} finally {
				process.chdir(original)
			}
		})
	})

	describe("unsupported formats", () => {
		it("rejects http:// URLs (only https supported)", () => {
			expectUrlValidation(
				parseAutoDetectUrl("http://github.com/owner/repo"),
				"Unsupported auto-detect target. Use owner/repo, a GitHub URL, git@host:path, https://host/repo.git, or a local path.",
			)
		})

		it("rejects file:// URLs", () => {
			expectUrlValidation(
				parseAutoDetectUrl("file:///path/to/repo"),
				"Unsupported auto-detect target. Use owner/repo, a GitHub URL, git@host:path, https://host/repo.git, or a local path.",
			)
		})

		it("rejects random text", () => {
			expectUrlValidation(
				parseAutoDetectUrl("not a url at all"),
				"Unsupported auto-detect target. Use owner/repo, a GitHub URL, git@host:path, https://host/repo.git, or a local path.",
			)
		})
	})
})
