import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCategories, getProvidersByCategory } from "@/lib/db";

export const revalidate = 3600;

function formatCategory(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const title = formatCategory(category);
  return {
    title: `${title} providers - stacksherpa`,
    description: `Compare ${title.toLowerCase()} API providers. Pricing, compliance, and known issues.`,
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const providers = await getProvidersByCategory(category);

  if (providers.length === 0) notFound();

  const title = formatCategory(category);

  return (
    <>
      <div className="breadcrumb">
        <a href="/">stacksherpa</a> &gt; {title}
      </div>
      <h1 className="page-title">
        {title} <span className="count">({providers.length})</span>
      </h1>
      <ul className="provider-list">
        {providers.map((p) => (
          <li key={p.id}>
            <a href={`/${category}/${p.id}`} className="provider-name">
              {p.name}
            </a>
            {p.description && (
              <span className="provider-desc">- {p.description}</span>
            )}
            <span className="badges">
              {p.freeTier && <span className="badge badge-free">free tier</span>}
              {p.compliance.map((c) => (
                <span key={c} className="badge">
                  {c}
                </span>
              ))}
              {p.ecosystem && <span className="badge">{p.ecosystem}</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
