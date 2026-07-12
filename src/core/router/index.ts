import {
    createNavigationContainerRef,
    useNavigation,
    useRoute,
} from "@react-navigation/native";
import { useCallback } from "react";
import { LogBox } from "react-native";

LogBox.ignoreLogs([
    "Non-serializable values were found in the navigation state",
]);

/** 路由key */
export const ROUTE_PATH = {
    /** 主页 */
    HOME: "home",
    /** 音乐播放页 */
    MUSIC_DETAIL: "music-detail",
    /** 搜索页 */
    SEARCH_PAGE: "search-page",
    /** 本地歌单页 */
    LOCAL_SHEET_DETAIL: "local-sheet-detail",
    /** 专辑页 */
    ALBUM_DETAIL: "album-detail",
    /** 歌手页 */
    ARTIST_DETAIL: "artist-detail",
    /** 榜单页 */
    TOP_LIST: "top-list",
    /** 榜单详情页 */
    TOP_LIST_DETAIL: "top-list-detail",
    /** 设置页 */
    SETTING: "setting",
    /** 本地音乐 */
    LOCAL: "local",
    /** 正在下载 */
    DOWNLOADING: "downloading",
    /** 从歌曲列表中搜索 */
    SEARCH_MUSIC_LIST: "search-music-list",
    /** 批量编辑 */
    MUSIC_LIST_EDITOR: "music-list-editor",
    /** 选择文件夹 */
    FILE_SELECTOR: "file-selector",
    /** 推荐歌单 */
    RECOMMEND_SHEETS: "recommend-sheets",
    /** 歌单详情 */
    PLUGIN_SHEET_DETAIL: "plugin-sheet-detail",
    /** 历史记录 */
    HISTORY: "history",
    /** 自定义主题 */
    SET_CUSTOM_THEME: "set-custom-theme",
    /** 权限管理 */
    PERMISSIONS: "permissions",
    /** 歌单编辑 */
    SHEET_EDITOR: "sheet-editor",
    /** 歌单浏览 */
    SHEET_BROWSER: "sheet-browser",
    /** 智能歌单 */
    SMART_SHEETS: "smart-sheets",
    /** 智能歌单详情 */
    SMART_SHEET_DETAIL: "smart-sheet-detail",
    /** 编辑歌单详情 */
    EDIT_MUSIC_SHEET_INFO: "edit-music-sheet-info",
} as const;

type ValueOf<T> = T[keyof T];
type RoutePaths = ValueOf<typeof ROUTE_PATH>;

type RouterParamsBase = Record<RoutePaths, any>;

export const navigationRef = createNavigationContainerRef<RouterParams>();
/** 路由参数 */
interface RouterParams extends RouterParamsBase {
    home: undefined;
    "music-detail": undefined;
    "search-page":
        | undefined
        | {
              initialQuery?: string;
              initialSearchType?: ICommon.SupportMediaType;
              initialSearchToken?: number;
              pluginHash?: string;
          };
    "local-sheet-detail": {
        id: string;
    };
    "album-detail": {
        albumItem: ICommon.WithMusicList<IAlbum.IAlbumItemBase>;
        pluginHash?: string;
    };
    "artist-detail": {
        artistItem: IArtist.IArtistItemBase;
        pluginHash: string;
    };
    setting: {
        type: string;
        initialPluginName?: string;
        initialPluginSettingRoute?:
            | "/pluginsetting/list"
            | "/pluginsetting/sort"
            | "/pluginsetting/subscribe"
            | "/pluginsetting/lx-source";
        // anchor?: string | number;
    };
    local: undefined;
    downloading: undefined;
    "search-music-list": {
        musicList: IMusic.IMusicItem[] | null;
        musicSheet?: IMusic.IMusicSheetItem;
    };
    "music-list-editor": {
        musicSheet?: Partial<IMusic.IMusicSheetItem>;
        musicList: IMusic.IMusicItem[] | null;
    };
    "file-selector": {
        fileType?: "folder" | "file" | "file-and-folder"; // 10: folder 11: file and folder,
        multi?: boolean; // 是否多选
        actionText?: string; // 底部行动点的文本
        actionIcon?: string; // 底部行动点的图标
        onAction?: (
            selectedFiles: {
                path: string;
                type: "file" | "folder";
            }[],
        ) => Promise<boolean>; // true会自动关闭，false会停在当前页面
        matchExtension?: (path: string) => boolean;
    };
    "top-list":
        | undefined
        | {
              initialPluginHash?: string;
          };
    "top-list-detail": {
        pluginHash: string;
        topList: IMusic.IMusicSheetItemBase;
    };
    "plugin-sheet-detail": {
        pluginHash?: string;
        sheetInfo: IMusic.IMusicSheetItemBase;
    };
    "sheet-editor": {
        sheetType: "local" | "starred";
    };
    "sheet-browser": {
        sheetType?: "local" | "starred";
    };
    "smart-sheets": undefined;
    "smart-sheet-detail": {
        type:
            | "recommended"
            | "recent-played"
            | "recent-added"
            | "most-played"
            | "favorite"
            | "local"
            | "downloaded"
            | "plugin-source"
            | "artist"
            | "album";
        platform?: string;
        value?: string;
    };
    "edit-music-sheet-info": {
        musicSheet: IMusic.IMusicSheetItem;
    };
}

/** 路由参数Hook */
export function useParams<T extends RoutePaths>(): RouterParams[T] {
    const route = useRoute<any>();

    const routeParams = route?.params as RouterParams[T];
    return routeParams;
}

/** 导航 */
export function useNavigate() {
    const navigation = useNavigation<any>();

    const navigate = useCallback(function <T extends RoutePaths>(
        route: T,
        params?: RouterParams[T],
    ) {
        navigation.navigate(route, params);
    },
    [navigation]);

    return navigate;
}
