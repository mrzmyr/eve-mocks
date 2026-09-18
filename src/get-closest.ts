/** Edit distance between two strings. See https://en.wikipedia.org/wiki/Levenshtein_distance */
function getDistance({ a, b }: { readonly a: string; readonly b: string }): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => {
    return index;
  });

  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];

    for (let column = 1; column <= b.length; column += 1) {
      let cost = 1;

      if (a[row - 1] === b[column - 1]) {
        cost = 0;
      }

      current.push(
        Math.min(
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
          (previous[column - 1] ?? 0) + cost,
        ),
      );
    }

    previous = current;
  }

  return previous[b.length] ?? 0;
}

/** The candidate nearest to `value`, for "did you mean" hints. */
export function getClosest({
  value,
  candidates,
}: {
  readonly value: string;
  readonly candidates: readonly string[];
}): string | undefined {
  return [...candidates].sort((a, b) => {
    return getDistance({ a: value, b: a }) - getDistance({ a: value, b });
  })[0];
}
