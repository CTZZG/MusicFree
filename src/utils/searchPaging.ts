export function resolveSearchPage(
    queryPage: number | undefined,
    isNewSearch: boolean,
    previousPage?: number,
) {
    return queryPage ?? (isNewSearch ? 1 : (previousPage ?? 0) + 1);
}
