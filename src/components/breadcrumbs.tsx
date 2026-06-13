import Link from "next/link";

type Crumb = { name: string; path: string };

// Visible breadcrumb trail. Pair with breadcrumbSchema() for the JSON-LD so the
// on-page UI and structured data stay in sync.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-8">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.path} className="flex items-center gap-1.5">
              {isLast ? (
                <span aria-current="page" className="text-amber-accent">
                  {item.name}
                </span>
              ) : (
                <>
                  <Link href={item.path} className="transition hover:text-amber-accent">
                    {item.name}
                  </Link>
                  <span className="text-slate-600">/</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
