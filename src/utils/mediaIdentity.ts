export function getMediaUniqueKey(mediaItem: ICommon.IMediaBase) {
    return `${mediaItem.platform}@${mediaItem.id}`;
}

export function parseMediaUniqueKey(key: string): ICommon.IMediaBase {
    const parsed = JSON.parse(key.trim());
    let platform;
    let id;
    if (typeof parsed === "string") {
        [platform, id] = parsed.split("@");
    } else {
        platform = parsed?.platform;
        id = parsed?.id;
    }
    if (!platform || !id) {
        throw new Error("mediakey不完整");
    }
    return {
        platform,
        id,
    };
}
