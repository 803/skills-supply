import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		coverage: {
			exclude: [
				"**/node_modules/**",
				"**/dist/**",
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/templates/**",
			],
			provider: "v8",
			reporter: ["text", "json", "html"],
		},
		environment: "node",
		exclude: ["**/node_modules/**", "**/dist/**", "**/templates/**"],
		globals: false,
		include: ["packages/**/*.test.ts", "packages/**/*.test.tsx"],
	},
})
