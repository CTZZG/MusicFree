import {
    assignPlaylistGroup,
    getPlaylistGroup,
    normalizePlaylistOrganization,
    selectLibraryPlaylists,
    togglePlaylistPin,
} from "../libraryPlaylistOrganization";

const sheets = [
    { id: "commute", title: "通勤歌单", platform: "local" },
    { id: "favorite", title: "default", platform: "local" },
    { id: "night", title: "Late Night Music", platform: "local" },
    { id: "jazz", title: "Jazz", platform: "local" },
];
const ids = sheets.map(sheet => sheet.id);
const favoriteId = "favorite";
const selectIds = (organization: ReturnType<typeof normalizePlaylistOrganization>, query = "", group: string | null = null) =>
    selectLibraryPlaylists(sheets, favoriteId, organization, query, group, "我喜欢").map(sheet => sheet.id);

describe("library playlist organization", () => {
    it("isolates corrupt stored values and removes annotations for deleted/favorite playlists", () => {
        const organization = normalizePlaylistOrganization({
            pinnedIds: ["missing", "jazz", "favorite", "jazz", null],
            groupBySheetId: { missing: "Deleted", favorite: "Protected", night: "  Relax  ", commute: 4, jazz: "  " },
        }, ids, favoriteId);
        expect(organization).toEqual({ pinnedIds: ["jazz"], groupBySheetId: { night: "Relax" } });
        expect(normalizePlaylistOrganization(null, ids, favoriteId)).toEqual({ pinnedIds: [], groupBySheetId: {} });
        expect(normalizePlaylistOrganization({ pinnedIds: "bad", groupBySheetId: [] }, ids, favoriteId)).toEqual({ pinnedIds: [], groupBySheetId: {} });
    });

    it("puts the favorite first and preserves original sheet order within the pinned tier", () => {
        let organization = togglePlaylistPin(undefined, ids, favoriteId, "jazz");
        organization = togglePlaylistPin(organization, ids, favoriteId, "night");
        expect(selectIds(organization)).toEqual(["favorite", "night", "jazz", "commute"]);
        organization = togglePlaylistPin(organization, ids, favoriteId, "night");
        expect(selectIds(organization)).toEqual(["favorite", "jazz", "commute", "night"]);
        expect(togglePlaylistPin(organization, ids, favoriteId, favoriteId)).toEqual(organization);
        expect(togglePlaylistPin(organization, ids, favoriteId, "missing")).toEqual(organization);
    });

    it("matches playlist names using Unicode/case normalization and the localized favorite name", () => {
        const organization = normalizePlaylistOrganization(undefined, ids, favoriteId);
        expect(selectIds(organization, "ｌＡＴＥ music")).toEqual(["night"]);
        expect(selectIds(organization, " 通勤 ")).toEqual(["commute"]);
        expect(selectIds(organization, "喜欢")).toEqual(["favorite"]);
        expect(selectIds(organization, "Unknown")).toEqual([]);
    });

    it("keeps groups independent from search and removes a group assignment without moving songs", () => {
        let organization = assignPlaylistGroup(undefined, ids, favoriteId, "night", " Relax ");
        organization = assignPlaylistGroup(organization, ids, favoriteId, "jazz", "Relax");
        expect(selectIds(organization, "", "Relax")).toEqual(["night", "jazz"]);
        expect(selectIds(organization, "jazz", "Relax")).toEqual(["jazz"]);
        expect(selectIds(organization, "", "")).toEqual(["favorite", "commute"]);
        organization = assignPlaylistGroup(organization, ids, favoriteId, "night", "");
        expect(getPlaylistGroup(organization, "night")).toBeUndefined();
        expect(assignPlaylistGroup(organization, ids, favoriteId, "favorite", "Group")).toEqual(organization);
        expect(assignPlaylistGroup(organization, ids, favoriteId, "missing", "Group")).toEqual(organization);
    });

    it("bounds group names and ignores inherited object keys when reading a playlist group", () => {
        const organization = assignPlaylistGroup(undefined, ids, favoriteId, "night", "x".repeat(100));
        expect(getPlaylistGroup(organization, "night")).toHaveLength(40);
        expect(getPlaylistGroup(organization, "toString")).toBeUndefined();
        const unusualId = assignPlaylistGroup(undefined, ["__proto__"], favoriteId, "__proto__", "Safe");
        expect(getPlaylistGroup(unusualId, "__proto__")).toBe("Safe");
        expect(Object.getPrototypeOf(unusualId.groupBySheetId)).toBe(Object.prototype);
    });
});
