import { getCategories } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatCategory(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default async function HomePage() {
  const categories = await getCategories();
  const total = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <>
      <h1 className="page-title">
        {total} providers across {categories.length} categories
      </h1>
      <div className="category-grid">
        {categories.map((c) => (
          <a key={c.category} href={`/${c.category}`}>
            {formatCategory(c.category)}{" "}
            <span className="count">({c.count})</span>
          </a>
        ))}
      </div>
    </>
  );
}
