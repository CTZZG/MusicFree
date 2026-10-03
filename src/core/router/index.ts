import {
    createNavigationContainerRef,
    StackActions,
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
    /** 主页：底部标签导航，标签见 HOME_TAB */
    HOME: "home",
    /** 音乐播放页 */
    MUSIC_DETAIL: "music-detail",
    /** 搜索页：是主页的一个底部标签，不在根栈里，用 navigateToSearch 跳转 */
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
    /** 本地音乐扫描设置 */
    LOCAL_SCAN_SETTINGS: "local-scan-settings",
    /** 本地音乐扫描结果 */
    LOCAL_SCAN_RESULT: "local-scan-result",
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
    /** 歌词逐行编辑 */
    LYRIC_EDITOR: "lyric-editor",
} as const;

/** 主页的底部标签。搜索标签沿用搜索页的路由名，useParams<"search-page"> 照常可用 */
export const HOME_TAB = {
    HOME: "home-tab",
    SEARCH: ROUTE_PATH.SEARCH_PAGE,
    LIBRARY: "library-tab",
    SETTINGS: "settings-tab",
} as const;

export type HomeTabName = (typeof HOME_TAB)[keyof typeof HOME_TAB];

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
    "local-scan-settings": undefined;
    "local-scan-result": {
        // 只传 id，报告本体放在 localMusicScanReportStore 里，避免整份候选列表常驻导航栈
        reportId: string;
    };
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
    "lyric-editor": {
        musicItem: IMusic.IMusicItem;
    };
}

/** 路由参数Hook */
export function useParams<T extends RoutePaths>(): RouterParams[T] {
    const route = useRoute<any>();

    const routeParams = route?.params as RouterParams[T];
    return routeParams;
}

/**
 * 切到主页的某个底部标签。先回到主页（关掉上面叠着的页面），再由标签导航
 * 处理 screen 参数；直接 navigate 会在根栈里再压一个主页。
 */
export function navigateToHomeTab<T extends HomeTabName>(
    tab: T,
    params?: T extends typeof HOME_TAB.SEARCH ? RouterParams["search-page"] : undefined,
) {
    if (!navigationRef.isReady()) {
        return;
    }
    navigationRef.dispatch(
        StackActions.popTo(ROUTE_PATH.HOME, { screen: tab, params }),
    );
}

/** 打开搜索标签；带 initialQuery 时直接搜索 */
export function navigateToSearch(params?: RouterParams["search-page"]) {
    // 搜索标签常驻不卸载：同一个关键词再搜一次时参数没变，靠新的 token 触发
    navigateToHomeTab(
        HOME_TAB.SEARCH,
        params?.initialQuery
            ? {
                ...params,
                initialSearchToken: params.initialSearchToken ?? Date.now(),
            }
            : params,
    );
}

/** 导航 */
export function useNavigate() {
    const navigation = useNavigation<any>();

    const navigate = useCallback(function <T extends RoutePaths>(
        route: T,
        params?: RouterParams[T],
    ) {
        if (route === ROUTE_PATH.SEARCH_PAGE) {
            // 搜索页在底部标签里，根栈里没有这个路由
            navigateToSearch(params as RouterParams["search-page"]);
            return;
        }
        navigation.navigate(route, params);
    },
    [navigation]);

    return navigate;
}
