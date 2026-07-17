import { useEffect, useMemo, useState } from "react";
import {
    getCachedMusicArtwork,
    getMusicArtworkLookupKey,
    isUsableMusicDetailArtwork,
    resolveMusicDetailArtwork,
} from "@/pages/musicDetail/artworkResolver";

interface IResolvedArtworkState {
    musicKey?: string;
    artwork?: string;
}

/**
 * 为当前可见的歌曲解析封面。多个界面会共享解析器的缓存和进行中的请求，
 * 但结果不会写回歌曲对象或播放历史。
 */
export default function useResolvedMusicArtwork(
    musicItem?: IMusic.IMusicItem | null,
) {
    const musicKey = useMemo(
        () => (musicItem ? getMusicArtworkLookupKey(musicItem) : undefined),
        [musicItem],
    );
    const directArtwork = isUsableMusicDetailArtwork(musicItem?.artwork)
        ? musicItem.artwork.trim()
        : undefined;
    const cachedArtwork = musicItem
        ? getCachedMusicArtwork(musicItem)
        : undefined;
    const [resolvedState, setResolvedState] = useState<IResolvedArtworkState>(
        () => ({ musicKey, artwork: directArtwork || cachedArtwork }),
    );

    useEffect(() => {
        if (!musicItem || !musicKey) {
            setResolvedState({});
            return;
        }
        if (directArtwork || cachedArtwork) {
            setResolvedState({
                musicKey,
                artwork: directArtwork || cachedArtwork,
            });
            return;
        }

        let active = true;
        setResolvedState({ musicKey });
        resolveMusicDetailArtwork(musicItem).then(artwork => {
            if (active) {
                setResolvedState({ musicKey, artwork });
            }
        });
        return () => {
            active = false;
        };
    }, [cachedArtwork, directArtwork, musicItem, musicKey]);

    const resolvedArtwork =
        resolvedState.musicKey === musicKey ? resolvedState.artwork : undefined;
    return directArtwork || cachedArtwork || resolvedArtwork;
}
