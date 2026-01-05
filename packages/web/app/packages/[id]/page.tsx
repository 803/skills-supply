import { notFound } from "next/navigation"
import { IndexedPackageCard } from "@/components/IndexedPackageCard"
import { buildSkInstallCommand, listIndexedPackages } from "@/lib/indexed-packages"

export const dynamic = "force-dynamic"

const numberFormatter = new Intl.NumberFormat("en-US")
const dateFormatter = new Intl.DateTimeFormat("en-US", {
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	month: "short",
	year: "numeric",
})

function toDate(value: Date | string | null | undefined): Date | null {
	if (!value) {
		return null
	}

	const date = value instanceof Date ? value : new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value: Date | string | null | undefined): string {
	const parsed = toDate(value)
	return parsed ? dateFormatter.format(parsed) : "n/a"
}

function formatNumber(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) {
		return "n/a"
	}

	return numberFormatter.format(value)
}

function parsePackageId(value: string): number | null {
	const parsed = Number.parseInt(value, 10)
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null
	}

	return parsed
}

export default async function PackagePage({
	params,
}: {
	params: Promise<{ id: string }>
}) {
	const resolvedParams = await params
	const id = parsePackageId(resolvedParams.id)
	if (!id) {
		notFound()
	}

	const packages = await listIndexedPackages()
	const pkg = packages.find((item) => item.id === id)

	if (!pkg) {
		notFound()
	}

	const repoCount = new Set(packages.map((item) => item.github_repo)).size
	const topicCount = new Set(packages.flatMap((item) => item.gh_topics ?? [])).size
	const latestUpdate = packages.reduce<Date | null>((latest, item) => {
		const candidate =
			toDate(item.updated_at) ??
			toDate(item.gh_updated_at) ??
			toDate(item.discovered_at)

		if (!candidate) {
			return latest
		}

		if (!latest || candidate > latest) {
			return candidate
		}

		return latest
	}, null)

	const installCommand = buildSkInstallCommand(pkg.declaration)

	return (
		<main className="relative min-h-screen overflow-hidden bg-stone-50 text-stone-900">
			<div className="pointer-events-none absolute inset-0 bg-graph-paper" />
			<div className="pointer-events-none absolute inset-0 bg-aurora opacity-80" />
			<div className="pointer-events-none absolute inset-0 bg-noise" />
			<div className="relative mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-16 lg:py-20">
				<header className="grid gap-6 animate-fade-in">
					<div className="inline-flex w-fit items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-[11px] uppercase tracking-[0.4em] text-stone-600 shadow-sm">
						<span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_0_6px_rgba(251,191,36,0.2)]" />
						Live package index
					</div>
					<div className="grid gap-4">
						<h1 className="text-4xl font-heading tracking-tight text-stone-900 sm:text-5xl lg:text-6xl">
							Indexed Packages
						</h1>
						<p className="max-w-2xl text-base text-stone-600 sm:text-lg">
							A stripped-back index of every plugin we have tracked. Open
							any record to see the full captured signal set.
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur">
							<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
								Total packages
							</p>
							<p className="mt-3 text-2xl font-heading text-stone-900">
								{formatNumber(packages.length)}
							</p>
							<p className="mt-1 text-xs text-stone-500">Indexed records</p>
						</div>
						<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur">
							<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
								GitHub repos
							</p>
							<p className="mt-3 text-2xl font-heading text-stone-900">
								{formatNumber(repoCount)}
							</p>
							<p className="mt-1 text-xs text-stone-500">
								Unique repositories
							</p>
						</div>
						<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur">
							<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
								Topics
							</p>
							<p className="mt-3 text-2xl font-heading text-stone-900">
								{formatNumber(topicCount)}
							</p>
							<p className="mt-1 text-xs text-stone-500">Distinct tags</p>
						</div>
						<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur">
							<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
								Last sync
							</p>
							<p className="mt-3 text-2xl font-heading text-stone-900">
								{latestUpdate ? formatDate(latestUpdate) : "n/a"}
							</p>
							<p className="mt-1 text-xs text-stone-500">
								Latest recorded update
							</p>
						</div>
					</div>
				</header>

				<section className="grid gap-8">
					<IndexedPackageCard
						pkg={pkg}
						index={0}
						installCommand={installCommand}
					/>
				</section>
			</div>
		</main>
	)
}
