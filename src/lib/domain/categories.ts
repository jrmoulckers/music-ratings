import type { CategoryRating } from './types';

export function categoryKey(label: string): string {
  return label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function mergeCategoryRatings(
  ...groups: readonly (readonly CategoryRating[])[]
): CategoryRating[] {
  const byId = new Map<string, CategoryRating>();
  for (const rating of groups.flat()) {
    const previous = byId.get(rating.id);
    if (!previous || JSON.stringify(rating) > JSON.stringify(previous)) byId.set(rating.id, rating);
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Latest event per category, including withdrawals so an old score cannot reappear. */
export function categoryStandings(ratings: readonly CategoryRating[]): CategoryRating[] {
  const latest = new Map<string, CategoryRating>();
  for (const rating of ratings) {
    const key = categoryKey(rating.category);
    const previous = latest.get(key);
    if (
      !previous ||
      rating.at > previous.at ||
      (rating.at === previous.at && rating.id > previous.id)
    ) {
      latest.set(key, rating);
    }
  }
  return [...latest.values()].sort((a, b) =>
    categoryKey(a.category).localeCompare(categoryKey(b.category)),
  );
}
