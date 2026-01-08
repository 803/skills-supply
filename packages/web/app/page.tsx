import Link from "next/link"
import { getIndexedPackagesStats, listIndexedPackages } from "@/lib/indexed-packages"

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

function formatText(value: string | null | undefined): string {
	if (!value) {
		return "n/a"
	}

	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : "n/a"
}

function formatRepo(value: string | null | undefined): string {
	if (!value) {
		return "n/a"
	}

	const trimmed = value.trim()
	if (!trimmed) {
		return "n/a"
	}

	if (trimmed.startsWith("git@github.com:")) {
		return trimmed.replace("git@github.com:", "").replace(/\.git$/, "")
	}

	const normalized = trimmed.replace(/^https?:\/\//, "")
	if (normalized.startsWith("github.com/")) {
		return normalized.replace("github.com/", "").replace(/\.git$/, "")
	}

	return normalized.replace(/\.git$/, "")
}

interface StatCardProps {
	label: string
	value: string
	hint?: string
}

function StatCard({ label, value, hint }: StatCardProps) {
	return (
		<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur">
			<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
				{label}
			</p>
			<p className="mt-3 text-2xl font-heading text-stone-900">{value}</p>
			{hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
		</div>
	)
}

export default async function Home() {
	const [packages, stats] = await Promise.all([
		listIndexedPackages({ limit: 50 }),
		getIndexedPackagesStats(),
	])

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
						<StatCard
							label="Total packages"
							value={formatNumber(stats.totalPackages)}
							hint="Indexed records"
						/>
						<StatCard
							label="GitHub repos"
							value={formatNumber(stats.uniqueRepos)}
							hint="Unique repositories"
						/>
						<StatCard
							label="Topics"
							value={formatNumber(stats.uniqueTopics)}
							hint="Distinct tags"
						/>
						<StatCard
							label="Last sync"
							value={
								stats.latestUpdate
									? formatDate(stats.latestUpdate)
									: "n/a"
							}
							hint="Latest recorded update"
						/>
					</div>
				</header>

				<section className="grid gap-8">
					{packages.length === 0 ? (
						<div className="rounded-3xl border border-dashed border-stone-300 bg-white/80 p-12 text-center text-stone-600 shadow-sm">
							<p className="text-lg font-heading text-stone-800">
								No indexed packages yet.
							</p>
							<p className="mt-2 text-sm">
								Run the discovery pipeline to populate the index.
							</p>
						</div>
					) : (
						<div className="grid gap-3">
							{packages.map((pkg, index) => (
								<Link
									key={pkg.id}
									href={`/packages/${pkg.id}`}
									className="group relative overflow-hidden rounded-2xl border border-stone-200/70 bg-white/80 px-6 py-5 shadow-[0_20px_60px_-50px_rgba(15,23,42,0.35),0_2px_12px_rgba(15,23,42,0.08)] backdrop-blur animate-slide-up transition hover:-translate-y-0.5"
									style={{
										animationDelay: `${Math.min(index, 12) * 0.04}s`,
									}}
								>
									<div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-amber-200/50 blur-2xl transition duration-500 group-hover:scale-110" />
									<div className="relative flex flex-nowrap gap-6">
										<div className="min-w-0">
											<p className="text-[10px] uppercase tracking-[0.32em] text-stone-500">
												GitHub owner/repo
											</p>
											<p className="mt-2 text-lg font-heading text-stone-900 sm:text-xl">
												{formatRepo(pkg.gh_repo)}
											</p>
										</div>
										<div className="min-w-0">
											<p className="text-[10px] uppercase tracking-[0.32em] text-stone-500">
												Package name
											</p>
											<p className="mt-2 text-lg font-heading text-stone-900 sm:text-xl">
												{formatText(pkg.name)}
											</p>
										</div>
										<div className="min-w-0">
											<p className="text-[10px] uppercase tracking-[0.32em] text-stone-500">
												Package path
											</p>
											<p className="mt-2 text-lg font-heading text-stone-900 sm:text-xl">
												{formatText(pkg.path)}
											</p>
										</div>
									</div>
								</Link>
							))}
						</div>
					)}
				</section>
			</div>
		</main>
	)
}
