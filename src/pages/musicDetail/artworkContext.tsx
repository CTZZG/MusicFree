import { ImgAsset } from "@/constants/assetsConst";
import { useCurrentMusic } from "@/core/trackPlayer";
import useResolvedMusicArtwork from "@/hooks/useResolvedMusicArtwork";
import React, {
    PropsWithChildren,
    createContext,
    useContext,
    useMemo,
} from "react";
import { getMusicArtworkLookupKey } from "./artworkResolver";

export interface IMusicDetailArtworkContextValue {
    musicKey?: string;
    coverArtwork?: string;
    ambientArtwork?: string;
    displayArtwork: string | number;
}

const defaultArtworkValue: IMusicDetailArtworkContextValue = {
    displayArtwork: ImgAsset.albumDefault,
};

const MusicDetailArtworkContext =
    createContext<IMusicDetailArtworkContextValue>(defaultArtworkValue);

export function MusicDetailArtworkProvider({ children }: PropsWithChildren) {
    const musicItem = useCurrentMusic();
    const artwork = useResolvedMusicArtwork(musicItem);
    const musicKey = musicItem
        ? getMusicArtworkLookupKey(musicItem)
        : undefined;

    const value = useMemo<IMusicDetailArtworkContextValue>(() => {
        return {
            musicKey,
            coverArtwork: artwork,
            ambientArtwork: artwork,
            displayArtwork: artwork || ImgAsset.albumDefault,
        };
    }, [artwork, musicKey]);

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
