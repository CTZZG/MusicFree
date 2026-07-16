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
} from "./artworkResolver";

interface IResolvedArtworkState {
    musicKey?: string;
    artwork?: string;
}

const MusicDetailArtworkContext = createContext<any>(ImgAsset.albumDefault);

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
        if (!musicItem || !musicKey || directArtwork) {
            return;
        }

        let active = true;
        resolveMusicDetailArtwork(musicItem).then(artwork => {
            if (active) {
                setResolvedState({ musicKey, artwork });
            }
        });
        return () => {
            active = false;
        };
    }, [directArtwork, musicItem, musicKey]);

    const artwork = useMemo(() => {
        if (directArtwork) {
            return directArtwork;
        }
        if (resolvedState.musicKey === musicKey && resolvedState.artwork) {
            return resolvedState.artwork;
        }
        return ImgAsset.albumDefault;
    }, [directArtwork, musicKey, resolvedState]);

    return (
        <MusicDetailArtworkContext.Provider value={artwork}>
            {children}
        </MusicDetailArtworkContext.Provider>
    );
}

export function useMusicDetailArtwork() {
    return useContext(MusicDetailArtworkContext);
}
