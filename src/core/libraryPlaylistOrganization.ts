/** Library annotations live in AppConfig; they never change playlist membership. */
export interface LibraryPlaylistOrganization {
    pinnedIds: string[];
    groupBySheetId: Record<string, string>;
}

const MAX_GROUP_NAME_LENGTH = 40;

export function normalizePlaylistOrganization(
    value: unknown,
    sheetIds: readonly string[],
    favoriteId: string,
): LibraryPlaylistOrganization {
    const knownIds = new Set(sheetIds);
    knownIds.delete(favoriteId);
    const stored = value && typeof value === "object"
        ? value as Partial<LibraryPlaylistOrganization>
        : {};
    const pinnedIds = Array.isArray(stored.pinnedIds)
        ? [...new Set(stored.pinnedIds.filter(id => typeof id === "string" && knownIds.has(id)))]
        : [];
    const groups = stored.groupBySheetId;
    const entries = groups && typeof groups === "object" && !Array.isArray(groups)
        ? Object.entries(groups).flatMap(([id, group]) => {
            const name = typeof group === "string" ? group.trim().slice(0, MAX_GROUP_NAME_LENGTH) : "";
            return knownIds.has(id) && name ? [[id, name] as const] : [];
        })
        : [];
    return { pinnedIds, groupBySheetId: Object.fromEntries(entries) };
}

export function getPlaylistGroup(organization: LibraryPlaylistOrganization, id: string) {
    return Object.prototype.hasOwnProperty.call(organization.groupBySheetId, id)
        ? organization.groupBySheetId[id]
        : undefined;
}

export function togglePlaylistPin(
    value: unknown,
    sheetIds: readonly string[],
    favoriteId: string,
    id: string,
) {
    const organization = normalizePlaylistOrganization(value, sheetIds, favoriteId);
    if (id === favoriteId || !sheetIds.includes(id)) {
        return organization;
    }
    organization.pinnedIds = organization.pinnedIds.includes(id)
        ? organization.pinnedIds.filter(pinnedId => pinnedId !== id)
        : [...organization.pinnedIds, id];
    return organization;
}

export function assignPlaylistGroup(
    value: unknown,
    sheetIds: readonly string[],
    favoriteId: string,
    id: string,
    group: string,
) {
    const organization = normalizePlaylistOrganization(value, sheetIds, favoriteId);
    if (id === favoriteId || !sheetIds.includes(id)) {
        return organization;
    }
    const name = group.trim().slice(0, MAX_GROUP_NAME_LENGTH);
    organization.groupBySheetId = Object.fromEntries([
        ...Object.entries(organization.groupBySheetId).filter(([sheetId]) => sheetId !== id),
        ...(name ? [[id, name]] : []),
    ]);
    return organization;
}

function searchText(value: string) {
    return value.normalize("NFKC").toLowerCase();
}

/** Preserve the user's sheet order within each tier: favorite, pinned, other. */
export function selectLibraryPlaylists(
    sheets: readonly IMusic.IMusicSheetItemBase[],
    favoriteId: string,
    organization: LibraryPlaylistOrganization,
    query: string,
    group: string | null,
    favoriteTitle: string,
) {
    const terms = searchText(query.trim()).split(/\s+/).filter(Boolean);
    const pinned = new Set(organization.pinnedIds);
    const rank = (id: string) => id === favoriteId ? 0 : pinned.has(id) ? 1 : 2;
    return sheets.filter(sheet => {
        const title = searchText(sheet.id === favoriteId ? favoriteTitle : sheet.title ?? "");
        return terms.every(term => title.includes(term)) && (
            group === null || (getPlaylistGroup(organization, sheet.id) ?? "") === group
        );
    }).sort((left, right) => rank(left.id) - rank(right.id));
}
