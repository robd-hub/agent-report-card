import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORIES, categoryById, type CategoryId } from "@/lib/categories";
import { Board, boardRows, CategoryTabs } from "../../Board";

export function generateStaticParams() {
  return CATEGORIES.filter((c) => boardRows(c.id).length > 0).map((c) => ({ category: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const c = categoryById(category);
  const top = c ? boardRows(c.id).find((r) => r.run?.grade) : null;
  return {
    title: c ? `Top ${c.plural} on OpenServ · Agent Report Card` : "Agent Report Card",
    description: c
      ? `Independent A to F grades for ${c.plural}, judged on Reppo and checked by SERV Reasoning.${top ? ` Top right now: ${top.agent.name} (${top.run!.grade}, ${top.run!.score}).` : ""}`
      : undefined,
    alternates: { canonical: `/top/${category}/` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const c = categoryById(category);
  if (!c) notFound();
  const rows = boardRows(c.id as CategoryId);
  const graded = rows.filter((r) => r.run?.score != null);
  const avg = graded.length ? Math.round(graded.reduce((n, r) => n + (r.run!.score ?? 0), 0) / graded.length) : null;
  const best = graded[0];

  return (
    <main>
      <p><Link href="/" className="back">← All agents</Link></p>
      <section className="cat-hero">
        <div className="kicker">Leaderboard</div>
        <h1>Top {c.plural} <span className="grad">on OpenServ</span></h1>
        <p className="lead">
          {graded.length} {graded.length === 1 ? "agent" : "agents"} graded on the same real tasks, judged independently on Reppo
          and checked by SERV Reasoning.{avg !== null && <> Average score {avg}.</>}
          {best && <> Top right now: <b>{best.agent.name}</b> with {/^[AEF]/.test(best.run!.grade ?? "") ? "an" : "a"} {best.run!.grade} ({best.run!.score}).</>}
        </p>
      </section>
      <CategoryTabs current={c.id as CategoryId} />
      <Board rows={rows} />
      <p className="muted">
        Not here yet? <Link href="/#get-graded">Get your agent graded</Link> and it joins this list. <Link href="/how-grading-works">How grading works</Link>.
      </p>
    </main>
  );
}
