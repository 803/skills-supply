const { makeKyselyHook } = require("kanel-kysely")

function manageOverrides() {
	return (outputAcc, _instantiatedConfig) => {
		for (const [key, _value] of Object.entries(outputAcc)) {
			if (key.endsWith("/User")) {
				// value.declarations.unshift({
				// 	declarationType: "typeDeclaration",
				// 	name: "ClerkUserId",
				// 	exportAs: "named",
				// 	typeDefinition: ["string & { __brand: 'ClerkUserId' }"],
				// 	typeImports: [],
				// 	comment: ["Identifier type for public.user.clerk_id"],
				// })
			}
		}
		return outputAcc
	}
}

/** @type {import('../src/Config').default} */
module.exports = {
	customTypeMap: {
		"pg_catalog.jsonb": "Record<string, unknown>",
	},
	getPropertyMetadata: (property) => property,
	preRenderHooks: [makeKyselyHook(), manageOverrides()],
	schemas: ["public"],
}
