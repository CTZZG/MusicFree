import React, {
    PropsWithChildren,
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
} from "react";

type SongInfoVariant = "card" | "hero";

interface IMusicDetailMeasuredLayout {
    /** 专辑页内容区的实际高度：从顶部（导航栏浮在上面）到进度条上沿 */
    contentHeight: number | null;
    /** 歌名区域的实际高度，随系统字体大小变化 */
    songInfoHeight: Record<SongInfoVariant, number | null>;
}

interface IMusicDetailLayoutContext {
    measured: IMusicDetailMeasuredLayout;
    reportContentHeight(height: number): void;
    reportSongInfoHeight(variant: SongInfoVariant, height: number): void;
}

const initialMeasuredLayout: IMusicDetailMeasuredLayout = {
    contentHeight: null,
    songInfoHeight: { card: null, hero: null },
};

const MusicDetailLayoutContext = createContext<IMusicDetailLayoutContext>({
    measured: initialMeasuredLayout,
    reportContentHeight() {},
    reportSongInfoHeight() {},
});

function isSameHeight(previous: number | null, next: number) {
    return previous !== null && Math.abs(previous - next) < 0.5;
}

/**
 * 播放页量到的实际高度。封面（albumCover）按它收紧尺寸，大图样式的背景
 * （background）按它对齐焦点区，两边用同一份数据才不会错位。
 */
export function MusicDetailLayoutProvider({ children }: PropsWithChildren) {
    const [measured, setMeasured] = useState(initialMeasuredLayout);

    const reportContentHeight = useCallback((height: number) => {
        setMeasured(previous =>
            isSameHeight(previous.contentHeight, height)
                ? previous
                : { ...previous, contentHeight: height },
        );
    }, []);

    const reportSongInfoHeight = useCallback(
        (variant: SongInfoVariant, height: number) => {
            setMeasured(previous =>
                isSameHeight(previous.songInfoHeight[variant], height)
                    ? previous
                    : {
                        ...previous,
                        songInfoHeight: {
                            ...previous.songInfoHeight,
                            [variant]: height,
                        },
                    },
            );
        },
        [],
    );

    const value = useMemo(
        () => ({ measured, reportContentHeight, reportSongInfoHeight }),
        [measured, reportContentHeight, reportSongInfoHeight],
    );

    return (
        <MusicDetailLayoutContext.Provider value={value}>
            {children}
        </MusicDetailLayoutContext.Provider>
    );
}

export function useMusicDetailLayout() {
    return useContext(MusicDetailLayoutContext);
}
