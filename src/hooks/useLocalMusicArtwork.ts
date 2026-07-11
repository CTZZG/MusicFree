import { useEffect, useState } from "react";

import {
    getDirectArtworkUri,
    resolveLocalMusicArtworkPath,
} from "@/core/localMusicArtworkManager";
import { getLocalPath } from "@/utils/mediaUtils";

export default function useLocalMusicArtwork(params: {
    artwork?: string | null;
    enabled: boolean;
    localMusicItem?: IMusic.IMusicItem;
}) {
    const { artwork, enabled, localMusicItem } = params;
    const directArtwork = getDirectArtworkUri(artwork);
    const localPath = localMusicItem ? getLocalPath(localMusicItem) : null;
    const canResolve = !!(enabled && !directArtwork && localPath);
    const [resolvedArtwork, setResolvedArtwork] = useState("");

    useEffect(() => {
        let cancelled = false;
        if (!canResolve || !localPath) {
            setResolvedArtwork("");
            return () => {
                cancelled = true;
            };
        }

        resolveLocalMusicArtworkPath(localPath).then(nextArtwork => {
            if (!cancelled) {
                setResolvedArtwork(nextArtwork);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [canResolve, localPath]);

    return directArtwork || resolvedArtwork;
}
