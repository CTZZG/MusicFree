import { ImgAsset } from "@/constants/assetsConst";
import { useCurrentMusic } from "@/core/trackPlayer";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import React, {
    PropsWithChildren,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    isUsableMusicDetailArtwork,
    resolveMusicDetailArtwork,
    resolveMusicDetailBackdrop,
} from "./artworkResolver";

interface IResolvedArtworkState {
    musicKey?: string;
    cover?: string;
    backdrop?: string;
}

export interface IMusicDetailArtworkContextValue {
    cover?: string;
    backdrop?: string;
    heroArtwork?: string;
    displayArtwork: string | number;
    hasRealCover: boolean;
    hasHeroArtwork: boolean;
}

const defaultArtworkValue: IMusicDetailArtworkContextValue = {
    displayArtwork: ImgAsset.albumDefault,
    hasRealCover: false,
    hasHeroArtwork: false,
};

const MusicDetailArtworkContext =
    createContext<IMusicDetailArtworkContextValue>(defaultArtworkValue);

export function MusicDetailArtworkProvider({ children }: PropsWithChildren) {
    const musicItem = useCurrentMusic();
    const musicKey = musicItem ? getMediaUniqueKey(musicItem) : undefined;
    const directArtwork = isUsableMusicDetailArtwork(musicItem?.artwork)
        ? musicItem.artwork.trim()
        : undefined;
    const [resolvedState, setResolvedState] = useState<IResolvedArtworkState>(
        {},
    );

    useEffect(() => {
        if (!musicItem || !musicKey) {
            setResolvedState({});
            return;
        }
        if (directArtwork) {
            setResolvedState({ musicKey, cover: directArtwork });
            return;
        }

        let active = true;
        // 先清掉上一首的视觉结果，避免快速切歌时旧图短暂串到新歌曲。
        setResolvedState({ musicKey });
        resolveMusicDetailArtwork(musicItem).then(cover => {
            if (active) {
                setResolvedState(previous =>
                    previous.musicKey === musicKey
                        ? { ...previous, cover }
                        : { musicKey, cover },
                );
            }
        });
        resolveMusicDetailBackdrop(musicItem).then(backdrop => {
            if (active) {
                setResolvedState(previous =>
                    previous.musicKey === musicKey
                        ? { ...previous, backdrop }
                        : { musicKey, backdrop },
                );
            }
        });
        return () => {
            active = false;
        };
    }, [directArtwork, musicItem, musicKey]);

    const value = useMemo<IMusicDetailArtworkContextValue>(() => {
        const stateMatches = resolvedState.musicKey === musicKey;
        const cover = directArtwork || (stateMatches ? resolvedState.cover : undefined);
        const backdrop = stateMatches ? resolvedState.backdrop : undefined;
        const heroArtwork = backdrop || cover;
        return {
            cover,
            backdrop,
            heroArtwork,
            displayArtwork: cover || ImgAsset.albumDefault,
            hasRealCover: !!cover,
            hasHeroArtwork: !!heroArtwork,
        };
    }, [directArtwork, musicKey, resolvedState]);

    return (
        <MusicDetailArtworkContext.Provider value={value}>
            {children}
        </MusicDetailArtworkContext.Provider>
    );
}

export function useMusicDetailArtwork() {
    return useContext(MusicDetailArtworkContext).displayArtwork;
}

export function useMusicDetailVisuals() {
    return useContext(MusicDetailArtworkContext);
}
