import type { ResCatalog } from "@/types";

const alphabetical = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function alphabeticalCatalog(catalog: ResCatalog): ResCatalog {
  return {
    ...catalog,
    games: [...catalog.games].sort(
      (a, b) => alphabetical.compare(a.label, b.label) || alphabetical.compare(a.key, b.key),
    ),
  };
}
