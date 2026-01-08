import Link from "next/link"
import { notFound } from "next/navigation"
import { IndexedPackageCard } from "@/components/IndexedPackageCard"
import {
	buildSkInstallCommand,
	fetchIndexedPackageWithSkills,
	type IndexedPackagesId,
} from "@/lib/indexed-packages"

export const dynamic = "force-dynamic"

const numberFormatter = new Intl.NumberFormat("en-US")

function formatSkillDescription(value: string | null | undefined): string | null {
	if (!value) {
		return null
	}

	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}

function formatNumber(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) {
		return "n/a"
	}

	return numberFormatter.format(value)
}

function skillRoot(path: string): string {
	const trimmed = path.trim()
	if (!trimmed) {
		return "root"
	}

	const [root] = trimmed.split("/")
	return root || trimmed
}

function parsePackageId(value: string): IndexedPackagesId | null {
	const parsed = Number.parseInt(value, 10)
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null
	}

	return parsed as IndexedPackagesId
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

	const packageWithSkills = await fetchIndexedPackageWithSkills(id)
	if (!packageWithSkills) {
		notFound()
	}

	const { package: pkg, skills } = packageWithSkills
	const installCommand = buildSkInstallCommand(pkg.declaration)
	const skillEntries = skills.map((skill, index) => ({
		description: formatSkillDescription(skill.description),
		index,
		root: skillRoot(skill.relative_path),
		skill,
	}))
	const describedSkillCount = skillEntries.filter((entry) =>
		Boolean(entry.description),
	).length
	const skillRootCount = new Set(skillEntries.map((entry) => entry.root)).size

	return (
		<main className="relative min-h-screen overflow-hidden bg-stone-50 text-stone-900">
			<div className="pointer-events-none absolute inset-0 bg-graph-paper" />
			<div className="pointer-events-none absolute inset-0 bg-aurora opacity-80" />
			<div className="pointer-events-none absolute inset-0 bg-noise" />
			<div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-16 lg:py-20">
				<nav className="animate-fade-in">
					<Link
						href="/"
						className="inline-flex items-center gap-2 text-sm text-stone-600 transition hover:text-stone-900"
					>
						<span aria-hidden="true">←</span>
						<span>All packages</span>
					</Link>
				</nav>

				<section className="grid gap-8">
					<IndexedPackageCard
						pkg={pkg}
						index={0}
						installCommand={installCommand}
					/>
					<section className="rounded-3xl border border-stone-200/80 bg-white/85 p-6 shadow-[0_20px_70px_-55px_rgba(15,23,42,0.45),0_2px_12px_rgba(15,23,42,0.08)] backdrop-blur animate-slide-up">
						<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
							<div>
								<p className="text-[11px] uppercase tracking-[0.38em] text-stone-500">
									Skills inside this package
								</p>
								<h3 className="mt-3 text-3xl font-heading text-stone-900">
									{formatNumber(skills.length)}{" "}
									<span className="text-stone-500">indexed skills</span>
								</h3>
								<p className="mt-2 max-w-2xl text-sm text-stone-600">
									Every skill is captured with its name, description,
									and relative path so you can scan the craft and
									surface the most relevant modules fast.
								</p>
							</div>
							<div className="grid gap-3 sm:grid-cols-3">
								<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-3 shadow-sm">
									<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
										Total skills
									</p>
									<p className="mt-2 text-xl font-heading text-stone-900">
										{formatNumber(skills.length)}
									</p>
								</div>
								<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-3 shadow-sm">
									<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
										Described
									</p>
									<p className="mt-2 text-xl font-heading text-stone-900">
										{formatNumber(describedSkillCount)}
									</p>
								</div>
								<div className="rounded-2xl border border-stone-200/80 bg-white/80 px-4 py-3 shadow-sm">
									<p className="text-[11px] uppercase tracking-[0.32em] text-stone-500">
										Path roots
									</p>
									<p className="mt-2 text-xl font-heading text-stone-900">
										{formatNumber(skillRootCount)}
									</p>
								</div>
							</div>
						</div>

						<div className="mt-8 grid gap-4 lg:grid-cols-2">
							{skills.length === 0 ? (
								<div className="rounded-2xl border border-dashed border-stone-300 bg-white/70 px-6 py-10 text-center text-stone-600">
									<p className="text-lg font-heading text-stone-800">
										No indexed skills for this package.
									</p>
									<p className="mt-2 text-sm">
										Run the discovery pipeline to capture the skill
										list.
									</p>
								</div>
							) : (
								skillEntries.map(
									({ description, index, root, skill }) => {
										return (
											<article
												key={skill.id}
												className="group relative overflow-hidden rounded-2xl border border-stone-200/70 bg-stone-50/80 px-5 py-5 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.4),0_2px_10px_rgba(15,23,42,0.08)] backdrop-blur transition duration-300 hover:-translate-y-0.5 animate-slide-up"
												style={{
													animationDelay: `${Math.min(index, 10) * 0.04}s`,
												}}
											>
												<div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-amber-200/40 blur-2xl transition duration-500 group-hover:scale-110" />
												<div className="pointer-events-none absolute -left-12 bottom-0 h-24 w-24 rounded-full bg-sky-200/40 blur-2xl transition duration-500 group-hover:scale-110" />
												<div className="relative flex h-full flex-col gap-3">
													<div className="flex items-center justify-between text-[11px] uppercase tracking-[0.32em] text-stone-500">
														<span>
															Skill{" "}
															{formatNumber(index + 1)}
														</span>
														<span>
															ID {formatNumber(skill.id)}
														</span>
													</div>
													<div>
														<h4 className="text-xl font-heading text-stone-900">
															{skill.name}
														</h4>
														{description ? (
															<p className="mt-2 text-sm text-stone-600">
																{description}
															</p>
														) : (
															<p className="mt-2 text-sm italic text-stone-500">
																No description captured
																for this skill.
															</p>
														)}
													</div>
													<div className="mt-auto flex flex-wrap items-center gap-2">
														<span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-amber-700">
															{root}
														</span>
														<span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 font-mono text-[11px] text-stone-700">
															{skill.relative_path}
														</span>
													</div>
												</div>
											</article>
										)
									},
								)
							)}
						</div>
					</section>
				</section>
			</div>
		</main>
	)
}
