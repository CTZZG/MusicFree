import pluginManager from "./pluginManager";
import { withTimeout } from "@/utils/promiseTimeout";

export const SHARE_DETAIL_TIMEOUT_MS = 3000;

/** Share the public detail page, never a resolved audio URL containing temporary credentials. */
export async function formatMusicShareMessage(musicItem: IMusic.IMusicItem) {
    const title = [musicItem.title, musicItem.artist]
        .map(value => String(value ?? "").trim())
        .filter(Boolean)
        .join(" - ");
    let url = "";
    try {
        const detail = await withTimeout(
            Promise.resolve().then(() =>
                pluginManager
                    .getByMedia(musicItem)
                    ?.methods.getMusicDetailPageUrl(musicItem),
            ),
            SHARE_DETAIL_TIMEOUT_MS,
        );
        // Ignore non-web schemes, URL user-info, and control characters from a plugin.
        if (
            typeof detail === "string" &&
            /^https?:\/\/[^\s/@?#]+(?:[/?#][^\s]*)?$/i.test(detail) &&
            Array.from(detail).every(
                char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
            )
        )
            url = detail;
    } catch {
        /* A missing detail page must not prevent sharing the title. */
    }
    return [title || "MusicFree", url].filter(Boolean).join("\n");
}
