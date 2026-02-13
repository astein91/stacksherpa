import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllProviderSlugs, getProviderDetail } from "@/lib/db";

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
  params: Promise<{ category: string; provider: string }>;
}): Promise<Metadata> {
  const { category, provider: providerId } = await params;
  const p = await getProviderDetail(providerId);
  if (!p) return { title: "Not found" };
  return {
    title: `${p.name} - ${formatCategory(category)} - stacksherpa`,
    description: p.description ?? `${p.name} API provider details.`,
  };
}

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ category: string; provider: string }>;
}) {
  const { category, provider: providerId } = await params;
  const p = await getProviderDetail(providerId);

  if (!p) notFound();

  const catTitle = formatCategory(category);

  return (
    <>
      <div className="breadcrumb">
        <a href="/">stacksherpa</a> &gt;{" "}
        <a href={`/${category}`}>{catTitle}</a> &gt; {p.name}
      </div>

      <h1 className="page-title">{p.name}</h1>
      {p.description && <p style={{ marginBottom: 12 }}>{p.description}</p>}

      {/* Links */}
      <div className="detail-meta" style={{ marginBottom: 16 }}>
        {p.website && (
          <>
            <a href={p.website} target="_blank" rel="noopener noreferrer">
              website
            </a>
            {" | "}
          </>
        )}
        {p.docsUrl && (
          <>
            <a href={p.docsUrl} target="_blank" rel="noopener noreferrer">
              docs
            </a>
            {" | "}
          </>
        )}
        {p.pricingUrl && (
          <>
            <a href={p.pricingUrl} target="_blank" rel="noopener noreferrer">
              pricing page
            </a>
            {" | "}
          </>
        )}
        {p.githubRepo && (
          <>
            <a
              href={`https://github.com/${p.githubRepo}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              github
            </a>
            {" | "}
          </>
        )}
        {p.package && <span>npm: {p.package}</span>}
      </div>

      {/* Overview */}
      <div className="detail-section">
        <h2>Overview</h2>
        <table className="pricing-table">
          <tbody>
            <tr>
              <td>Category</td>
              <td>{catTitle}</td>
            </tr>
            {p.ecosystem && (
              <tr>
                <td>Ecosystem</td>
                <td>{p.ecosystem}</td>
              </tr>
            )}
            {p.compliance.length > 0 && (
              <tr>
                <td>Compliance</td>
                <td>{p.compliance.join(", ")}</td>
              </tr>
            )}
            {p.dataResidency.length > 0 && (
              <tr>
                <td>Data Residency</td>
                <td>{p.dataResidency.join(", ")}</td>
              </tr>
            )}
            <tr>
              <td>Self-Hostable</td>
              <td>{p.selfHostable ? "Yes" : "No"}</td>
            </tr>
            <tr>
              <td>On-Prem</td>
              <td>{p.onPremOption ? "Yes" : "No"}</td>
            </tr>
            {p.bestFor.length > 0 && (
              <tr>
                <td>Best For</td>
                <td>{p.bestFor.join(", ")}</td>
              </tr>
            )}
            {p.lastVerified && (
              <tr>
                <td>Last Verified</td>
                <td>{p.lastVerified}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pricing */}
      {p.pricing && (
        <div className="detail-section">
          <h2>Pricing</h2>
          <table className="pricing-table">
            <tbody>
              <tr>
                <td>Model</td>
                <td>{p.pricing.type}</td>
              </tr>
              {p.pricing.freeTier && (
                <tr>
                  <td>Free Tier</td>
                  <td>
                    {p.pricing.freeTier.included}
                    {p.pricing.freeTier.limitations &&
                      p.pricing.freeTier.limitations.length > 0 && (
                        <ul style={{ margin: "4px 0 0 16px", fontSize: 12 }}>
                          {p.pricing.freeTier.limitations.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      )}
                  </td>
                </tr>
              )}
              {p.pricing.unitPricing && (
                <tr>
                  <td>Unit Price</td>
                  <td>
                    ${p.pricing.unitPricing.price} / {p.pricing.unitPricing.unit}
                  </td>
                </tr>
              )}
              {p.pricing.source && (
                <tr>
                  <td>Source</td>
                  <td>
                    <a
                      href={p.pricing.source}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      pricing page
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {p.pricing.plans && p.pricing.plans.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: "bold", marginTop: 8 }}>
                Plans
              </h3>
              <table className="bench-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Monthly</th>
                    <th>Yearly</th>
                    <th>Includes</th>
                  </tr>
                </thead>
                <tbody>
                  {p.pricing.plans.map((plan) => (
                    <tr key={plan.name}>
                      <td>{plan.name}</td>
                      <td>
                        {plan.priceMonthly != null
                          ? `$${plan.priceMonthly}`
                          : "-"}
                      </td>
                      <td>
                        {plan.priceYearly != null
                          ? `$${plan.priceYearly}`
                          : "-"}
                      </td>
                      <td>{plan.includes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* Strengths & Weaknesses */}
      {(p.strengths.length > 0 || p.weaknesses.length > 0) && (
        <div className="detail-section">
          <h2>Strengths &amp; Weaknesses</h2>
          {p.strengths.length > 0 && (
            <>
              <strong style={{ fontSize: 13 }}>Strengths:</strong>
              <ul>
                {p.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {p.weaknesses.length > 0 && (
            <>
              <strong style={{ fontSize: 13, marginTop: 4, display: "block" }}>
                Weaknesses:
              </strong>
              <ul>
                {p.weaknesses.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Routing hints */}
      {(p.bestWhen.length > 0 || p.avoidIf.length > 0) && (
        <div className="detail-section">
          <h2>When to Use</h2>
          {p.bestWhen.length > 0 && (
            <>
              <strong style={{ fontSize: 13 }}>Best when:</strong>
              <ul>
                {p.bestWhen.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </>
          )}
          {p.avoidIf.length > 0 && (
            <>
              <strong style={{ fontSize: 13, marginTop: 4, display: "block" }}>
                Avoid if:
              </strong>
              <ul>
                {p.avoidIf.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Known Issues */}
      {p.knownIssues.length > 0 && (
        <div className="detail-section">
          <h2>Known Issues ({p.knownIssues.length})</h2>
          <ul>
            {p.knownIssues.map((issue) => (
              <li key={issue.id}>
                <span className={`severity-${issue.severity}`}>
                  [{issue.severity}]
                </span>{" "}
                {issue.symptom}
                {issue.scope && (
                  <span className="detail-meta"> ({issue.scope})</span>
                )}
                {issue.workaround && (
                  <div className="detail-meta">
                    Workaround: {issue.workaround}
                  </div>
                )}
                {issue.githubIssue && (
                  <div className="detail-meta">
                    <a
                      href={issue.githubIssue}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      GitHub issue
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Alternatives */}
      {p.alternatives.length > 0 && (
        <div className="detail-section">
          <h2>Alternatives</h2>
          <p style={{ fontSize: 13 }}>
            {p.alternatives.map((alt, i) => (
              <span key={alt}>
                {i > 0 && ", "}
                <a href={`/${category}/${alt}`}>{alt}</a>
              </span>
            ))}
          </p>
        </div>
      )}
    </>
  );
}
