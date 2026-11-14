import { validateRemoteMediaUrlForPlayback } from "@/utils/remoteMediaUrl";
import type { PlayerRenditionSource } from "../playerAdapter/types";

/** Admit the video independently of any plugin-supplied native policy fields. */
export async function admitMusicVideoSource(source: IPlugin.IVideoSourceResult, allowHttp: boolean): Promise<PlayerRenditionSource> {
    if (!source.url || !/^https?:\/\//i.test(source.url) || (source as unknown as Record<string, unknown>).ekey || (source as unknown as Record<string, unknown>).cek) {
        throw new Error("Video source unavailable");
    }
    const checked = await validateRemoteMediaUrlForPlayback(source.url, { allowHttp });
    if (!checked.ok) throw new Error("Video source unavailable");
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(source.headers ?? {})) {
        if (typeof value !== "string" || /[\r\n]/.test(name + value)) throw new Error("Invalid video headers");
        headers[name] = value;
    }
    return { url: checked.url, headers, userAgent: source.userAgent,
        allowInsecureHttpPlayback: allowHttp && checked.url.startsWith("http:") };
}
