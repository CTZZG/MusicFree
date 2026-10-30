import Config from "./appConfig";
import { normalizePlaylistOrganization, type LibraryPlaylistOrganization } from "./libraryPlaylistOrganization";
import { normalizeHomeOrder } from "./homeSectionOrder";

// Only portable UI choices; never restore playback intentions, permissions or device paths.
const booleanKeys = [
    "theme.useEnhancedHome", "theme.hideHomeDiscovery", "theme.hideHomeHeroCard",
    "theme.hideHomeRecentListening", "theme.hideHomeOperations",
] as const;
export interface BackupPreferences {
    settings?: Record<string, unknown>;
    playlistOrganization?: LibraryPlaylistOrganization;
}
const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function backupPreferences(sheetIds: string[], favoriteId: string): BackupPreferences {
    const settings: Record<string, unknown> = {};
    for (const key of booleanKeys) {
        const value = Config.getConfig(key);
        if (typeof value === "boolean") settings[key] = value;
    }
    const view = Config.getConfig("library.playlistView");
    if (view === "grid" || view === "list") settings["library.playlistView"] = view;
    const order = Config.getConfig("theme.homeSectionOrder");
    if (Array.isArray(order)) settings["theme.homeSectionOrder"] = normalizeHomeOrder(order);
    return {
        settings,
        playlistOrganization: normalizePlaylistOrganization(
            Config.getConfig("library.playlistOrganization"), sheetIds, favoriteId,
        ),
    };
}

export function restoreBackupPreferences(
    value: unknown, idMap: Record<string, string>, sheetIds: string[], favoriteId: string,
) {
    const preferences = object(value);
    const settings = object(preferences.settings);
    let count = 0;
    for (const key of booleanKeys) {
        if (typeof settings[key] === "boolean") {
            Config.setConfig(key, settings[key]);
            count++;
        }
    }
    const view = settings["library.playlistView"];
    if (view === "grid" || view === "list") {
        Config.setConfig("library.playlistView", view); count++;
    }
    const order = settings["theme.homeSectionOrder"];
    if (Array.isArray(order) && order.every(item => typeof item === "string")) {
        Config.setConfig("theme.homeSectionOrder", normalizeHomeOrder(order)); count++;
    }
    if (preferences.playlistOrganization && typeof preferences.playlistOrganization === "object") {
        const incoming = normalizePlaylistOrganization(preferences.playlistOrganization, Object.keys(idMap), favoriteId);
        const current = normalizePlaylistOrganization(Config.getConfig("library.playlistOrganization"), sheetIds, favoriteId);
        const mapped = (id: string) => Object.prototype.hasOwnProperty.call(idMap, id) ? idMap[id] : undefined;
        const groups = { ...current.groupBySheetId };
        for (const [oldId, name] of Object.entries(incoming.groupBySheetId)) {
            const id = mapped(oldId);
            if (id && !Object.prototype.hasOwnProperty.call(groups, id)) {
                Object.defineProperty(groups, id, { value: name, enumerable: true, configurable: true, writable: true });
            }
        }
        Config.setConfig("library.playlistOrganization", normalizePlaylistOrganization({
            pinnedIds: [...current.pinnedIds, ...incoming.pinnedIds.map(mapped).filter(Boolean)],
            groupBySheetId: groups,
        }, sheetIds, favoriteId));
        count++;
    }
    return count;
}
