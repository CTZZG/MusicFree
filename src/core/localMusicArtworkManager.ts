import {
    createLocalMusicArtworkResolver,
    getDirectArtworkUri,
    mergeResolvedArtwork,
    stripEphemeralLocalArtwork,
} from "@/core/localMusicArtwork";
import Mp3Util from "@/native/mp3Util";
import { removeFileScheme } from "@/utils/fileUtils";
import { getLocalPath } from "@/utils/mediaUtils";

function isRemoteMediaUrl(urlLike?: string | null) {
    return typeof urlLike === "string" && /^https?:\/\//i.test(urlLike);
}

function normalizeLocalArtworkPath(localPath: string) {
    if (localPath.startsWith("content://")) {
        return localPath;
    }
    const filePath = removeFileScheme(localPath);
    try {
        return decodeURI(filePath);
    } catch {
        return filePath;
    }
}

const localMusicArtworkResolver = createLocalMusicArtworkResolver(localPath =>
    Mp3Util.getMediaCoverImg(localPath),
);

export function resolveLocalMusicArtworkPath(localPath?: string | null) {
    if (!localPath || isRemoteMediaUrl(localPath)) {
        return Promise.resolve("");
    }
    return localMusicArtworkResolver.resolve(
        normalizeLocalArtworkPath(localPath),
    );
}

export function resolveLocalMusicArtwork(
    musicItem?: ICommon.IMediaBase | null,
) {
    const directArtwork = getDirectArtworkUri(musicItem?.artwork);
    if (directArtwork) {
        return Promise.resolve(directArtwork);
    }
    return resolveLocalMusicArtworkPath(
        musicItem ? getLocalPath(musicItem) : null,
    );
}

export function clearLocalMusicArtworkCache() {
    localMusicArtworkResolver.clear();
}

export function invalidateLocalMusicArtworkCache(localPath?: string | null) {
    if (!localPath || isRemoteMediaUrl(localPath)) {
        return;
    }
    localMusicArtworkResolver.invalidate(
        normalizeLocalArtworkPath(localPath),
    );
}

export { getDirectArtworkUri, mergeResolvedArtwork, stripEphemeralLocalArtwork };
