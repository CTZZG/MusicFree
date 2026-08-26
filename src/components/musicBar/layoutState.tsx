import React, {
    PropsWithChildren,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { AppState, Keyboard } from "react-native";

import Theme from "@/core/theme";
import { ROUTE_PATH } from "@/core/router";
import { useCurrentMusic } from "@/core/trackPlayer";
import {
    MUSIC_BAR_FLOATING_BOTTOM,
    MUSIC_BAR_HEIGHT,
} from "./layout";
import {
    IMusicBarLayoutPolicyResult,
    resolveMusicBarLayout,
} from "./layoutPolicy";

const musicBarRouteNames = new Set<string>([
    ROUTE_PATH.HOME,
    ROUTE_PATH.SEARCH_PAGE,
    ROUTE_PATH.LOCAL_SHEET_DETAIL,
    ROUTE_PATH.ALBUM_DETAIL,
    ROUTE_PATH.ARTIST_DETAIL,
    ROUTE_PATH.TOP_LIST,
    ROUTE_PATH.TOP_LIST_DETAIL,
    ROUTE_PATH.LOCAL,
    ROUTE_PATH.DOWNLOADING,
    ROUTE_PATH.SEARCH_MUSIC_LIST,
    ROUTE_PATH.RECOMMEND_SHEETS,
    ROUTE_PATH.PLUGIN_SHEET_DETAIL,
    ROUTE_PATH.HISTORY,
    ROUTE_PATH.SHEET_BROWSER,
    ROUTE_PATH.SMART_SHEETS,
    ROUTE_PATH.SMART_SHEET_DETAIL,
]);

interface IMusicBarLayoutContextValue {
    routeName: string;
    transitionInProgress: boolean;
    keyboardVisible: boolean;
    drawerOpen: boolean;
    layout: IMusicBarLayoutPolicyResult;
    setDrawerOpen(open: boolean): void;
}

const defaultLayout = resolveMusicBarLayout({
    routeSupportsMusicBar: false,
    hasCurrentMusic: false,
    keyboardVisible: false,
    drawerOpen: false,
    floatingTheme: false,
    barHeight: MUSIC_BAR_HEIGHT,
    floatingBottom: MUSIC_BAR_FLOATING_BOTTOM,
});

const MusicBarLayoutContext = createContext<IMusicBarLayoutContextValue>({
    routeName: "",
    transitionInProgress: false,
    keyboardVisible: false,
    drawerOpen: false,
    layout: defaultLayout,
    setDrawerOpen: () => undefined,
});

interface IMusicBarLayoutProviderProps extends PropsWithChildren {
    /**
     * 已提交的路由名（转场结束后才更新）。液态玻璃背板靠它决定何时采样，
     * 转场中途采样会抓到中间帧位图。
     */
    routeName: string;
    /**
     * 决定播放条显隐的路由名，导航一开始就更新。不能复用 routeName——那样
     * 播放条会在整个转场动画期间滞留在底部（进播放详情页时尤其明显）。
     * 缺省时退回 routeName，保持旧行为。
     */
    visibilityRouteName?: string;
    transitionInProgress: boolean;
}

export function MusicBarLayoutProvider(
    props: IMusicBarLayoutProviderProps,
) {
    const {
        routeName,
        visibilityRouteName,
        transitionInProgress,
        children,
    } = props;
    const effectiveVisibilityRoute = visibilityRouteName ?? routeName;
    const musicItem = useCurrentMusic();
    const floatingTheme = Theme.useTheme().id === "p-frosted-glass";
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);

    useEffect(() => {
        let keyboardResetTimer: ReturnType<typeof setTimeout> | null = null;
        const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
            setKeyboardVisible(true);
        });
        const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
            setKeyboardVisible(false);
        });
        const appStateSubscription = AppState.addEventListener(
            "change",
            nextState => {
                if (nextState !== "active") {
                    setKeyboardVisible(false);
                    return;
                }
                if (keyboardResetTimer) {
                    clearTimeout(keyboardResetTimer);
                }
                Keyboard.dismiss();
                keyboardResetTimer = setTimeout(() => {
                    setKeyboardVisible(false);
                }, 120);
            },
        );

        return () => {
            if (keyboardResetTimer) {
                clearTimeout(keyboardResetTimer);
            }
            showSubscription.remove();
            hideSubscription.remove();
            appStateSubscription.remove();
        };
    }, []);

    const layout = useMemo(
        () =>
            resolveMusicBarLayout({
                routeSupportsMusicBar: musicBarRouteNames.has(
                    effectiveVisibilityRoute,
                ),
                hasCurrentMusic: !!musicItem,
                keyboardVisible,
                drawerOpen,
                floatingTheme,
                barHeight: MUSIC_BAR_HEIGHT,
                floatingBottom: MUSIC_BAR_FLOATING_BOTTOM,
            }),
        [
            drawerOpen,
            effectiveVisibilityRoute,
            floatingTheme,
            keyboardVisible,
            musicItem,
        ],
    );
    const value = useMemo<IMusicBarLayoutContextValue>(
        () => ({
            routeName,
            transitionInProgress,
            keyboardVisible,
            drawerOpen,
            layout,
            setDrawerOpen,
        }),
        [
            drawerOpen,
            keyboardVisible,
            layout,
            routeName,
            transitionInProgress,
        ],
    );

    return (
        <MusicBarLayoutContext.Provider value={value}>
            {children}
        </MusicBarLayoutContext.Provider>
    );
}

export function useMusicBarLayoutState() {
    return useContext(MusicBarLayoutContext);
}
