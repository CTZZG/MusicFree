import type { Plugin } from "./plugin";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";
import { withTimeout } from "@/utils/promiseTimeout";
import { getPluginRuntimeRevision, subscribePluginRuntimeRevision } from "./enabledRevision";
import { parseCacheControl } from "@/utils/cacheControlPolicy";
import { MediaSourceResolutionError } from "./mediaSourceFailure";

export interface MusicVideoCandidate extends IPlugin.IVideoCandidate {
    readonly providerKey: string;
    readonly providerName: string;
    readonly originalSongKey: string;
}

interface VideoPluginManager {
    getByMedia(song: IMusic.IMusicItemBase): Plugin | null | undefined;
    getByName(name: string): Plugin | null | undefined;
    isPluginEnabled(plugin: Plugin): boolean;
}

interface CandidateOwner {
    plugin: Plugin;
    song: IMusic.IMusicItemBase;
    revision: number;
    legacy: boolean;
}

export class MusicVideoCancelled extends Error {
    constructor() {
        super("Music video request superseded");
    }
}

const text = (value: unknown, max = 300): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
const positive = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
const stableId = (value: unknown): string | undefined => {
    const id = text(value, 200);
    return id && !id.includes("://") && !Array.from(id).some(ch => ch.charCodeAt(0) < 32) ? id : undefined;
};

export function normalizeVideoQualities(value: unknown): IPlugin.IVideoQuality[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    return value.slice(0, 30).flatMap(raw => {
        const id = text(typeof raw === "string" ? raw : raw?.id ?? raw?.key, 80);
        if (!id || seen.has(id)) {
            return [];
        }
        seen.add(id);
        return [{ id, label: text(raw?.label, 80) ?? id, height: positive(raw?.height), bitrate: positive(raw?.bitrate) }];
    });
}

/** In-memory metadata only. Resolved URLs never enter this cache or the song object. */
export class MusicVideoSources {
    private owners = new WeakMap<MusicVideoCandidate, CandidateOwner>();
    private metadata = new Map<string, { until: number; data: MusicVideoCandidate[] }>();

    constructor(
        private readonly manager: VideoPluginManager,
        private readonly revision = getPluginRuntimeRevision,
        private readonly now = Date.now,
    ) { }

    supports(song: IMusic.IMusicItemBase | null | undefined): boolean {
        const p = song && this.manager.getByMedia(song);
        return !!p && this.manager.isPluginEnabled(p) && (
            p.supportedMethods.has("getMvSource") || (
                p.supportedMethods.has("getMusicVideos") && p.supportedMethods.has("getVideoSource")
            )
        );
    }

    private guard(owner: CandidateOwner, current: () => boolean, signal?: AbortSignal) {
        if (signal?.aborted || !current() || this.revision() !== owner.revision ||
            this.manager.getByName(owner.plugin.name) !== owner.plugin ||
            !this.manager.isPluginEnabled(owner.plugin)) {
            throw new MusicVideoCancelled();
        }
    }

    private async request<T>(operation: () => PromiseLike<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) {
            throw new MusicVideoCancelled();
        }
        let abort: (() => void) | undefined;
        let wasCancelled = false;
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => {
                wasCancelled = true; reject(new MusicVideoCancelled());
            };
            signal?.addEventListener("abort", abort, { once: true });
        });
        const unsubscribe = subscribePluginRuntimeRevision(() => abort?.());
        try {
            return await withTimeout(Promise.race([Promise.resolve().then(() => {
                if (wasCancelled) {
                    throw new MusicVideoCancelled();
                }
                return operation();
            }), cancelled]), 15000);
        } finally {
            unsubscribe();
            if (abort) {
                signal?.removeEventListener("abort", abort);
            }
        }
    }

    private candidate(raw: unknown, owner: CandidateOwner): MusicVideoCandidate | null {
        if (!raw || typeof raw !== "object") {
            return null;
        }
        const v = raw as IPlugin.IVideoCandidate;
        const id = stableId(v.id), title = text(v.title);
        if (!id || !title) {
            return null;
        }
        const value: MusicVideoCandidate = Object.freeze({
            id, title, artist: text(v.artist), artwork: text(v.artwork, 3000),
            durationSeconds: positive(v.durationSeconds),
            version: v.version === "official" || v.version === "live" ? v.version : "other",
            qualities: Object.freeze(normalizeVideoQualities(v.qualities).map(q => Object.freeze(q))), timelineId: stableId(v.timelineId),
            providerKey: owner.plugin.hash || owner.plugin.name,
            providerName: owner.plugin.name,
            originalSongKey: getMediaUniqueKey(owner.song),
        });
        this.owners.set(value, owner);
        return value;
    }

    async find(song: IMusic.IMusicItemBase, current: () => boolean, signal?: AbortSignal): Promise<MusicVideoCandidate[]> {
        if (!this.supports(song)) {
            return [];
        }
        const plugin = this.manager.getByMedia(song)!;
        const owner: CandidateOwner = {
            plugin, song: { ...song }, revision: this.revision(),
            legacy: !(plugin.supportedMethods.has("getMusicVideos") && plugin.supportedMethods.has("getVideoSource")),
        };
        this.guard(owner, current, signal);
        const key = `${plugin.hash}:${getMediaUniqueKey(song)}:${owner.revision}`;
        const policy = parseCacheControl(plugin.instance.cacheControl);
        const cached = policy === "cache" ? this.metadata.get(key) : undefined;
        if (cached && cached.until > this.now()) {
            this.metadata.delete(key);
            this.metadata.set(key, cached);
            return cached.data;
        }
        let raw: unknown;
        if (owner.legacy) {
            const fields = song as Record<string, unknown>;
            const associatedId = stableId(fields.mv) ?? stableId(fields.vid) ?? stableId(fields.bvid);
            // QQ exposes song.mv; Bilibili's selected video is already an explicit identity.
            // A generic old plugin without such metadata must actually resolve before claiming availability.
            const discovered = associatedId ? null : await this.request(() => plugin.methods.getMvSource(owner.song), signal);
            this.guard(owner, current, signal);
            if (discovered?.failure) {
                throw new MediaSourceResolutionError(discovered.failure.code, "Video discovery failed");
            }
            raw = associatedId || discovered?.url ? [{
                id: associatedId ?? String(song.id), title: fields.title, artist: fields.artist, artwork: fields.artwork,
                qualities: normalizeVideoQualities(discovered?.availableVideoQualities ?? plugin.instance.supportedVideoQualities),
                durationSeconds: positive(discovered?.duration), timelineId: text(discovered?.timelineId, 200),
            }] : [];
        } else {
            raw = await this.request(() => plugin.methods.getMusicVideos(owner.song), signal);
        }
        this.guard(owner, current, signal);
        if (!Array.isArray(raw)) {
            throw new MediaSourceResolutionError("plugin-error", "Invalid music video list");
        }
        const seen = new Set<string>();
        const data = raw.slice(0, 50).flatMap(v => {
            const item = this.candidate(v, owner);
            if (!item || seen.has(item.id)) {
                return [];
            }
            seen.add(item.id);
            return [item];
        });
        if (policy === "cache") {
            this.metadata.delete(key);
            this.metadata.set(key, { until: this.now() + (data.length ? 300000 : 60000), data });
            while (this.metadata.size > 50) {
                this.metadata.delete(this.metadata.keys().next().value!);
            }
        }
        return data;
    }

    async resolve(candidate: MusicVideoCandidate, quality: string | undefined, current: () => boolean, signal?: AbortSignal) {
        const owner = this.owners.get(candidate);
        if (!owner) {
            throw new MusicVideoCancelled();
        }
        this.guard(owner, current, signal);
        if (quality && !candidate.qualities?.some(q => q.id === quality)) {
            throw new MediaSourceResolutionError("source-rejected", "Unknown video quality");
        }
        const selected = quality ?? candidate.qualities?.find(q => q.id === "720p" || q.label === "720p")?.id;
        const result = await this.request(() => owner.legacy
            ? owner.plugin.methods.getMvSource(owner.song, selected)
            : owner.plugin.methods.getVideoSource({
                id: candidate.id, title: candidate.title, artist: candidate.artist,
                artwork: candidate.artwork, durationSeconds: candidate.durationSeconds,
                version: candidate.version, qualities: candidate.qualities, timelineId: candidate.timelineId,
            }, selected), signal);
        this.guard(owner, current, signal);
        if (!result?.url) {
            throw new MediaSourceResolutionError(result?.failure?.code ?? "unavailable", "No video source returned");
        }
        if (result.expiresAt !== undefined && (!positive(result.expiresAt) || result.expiresAt <= this.now())) {
            throw new MediaSourceResolutionError("unavailable", "Video source expired");
        }
        if (/\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)/i.test(result.url) || /mpegurl|dash\+xml/i.test(result.mimeType ?? "")) {
            throw new MediaSourceResolutionError("source-rejected", "Segmented video is not yet supported");
        }
        const available = normalizeVideoQualities(result.availableVideoQualities);
        const enriched = available.length ? this.candidate({ ...candidate, qualities: available }, owner)! : candidate;
        const declaredQuality = normalizeVideoQualities([result.quality])[0];
        const returnedId = declaredQuality?.id ?? text(result.videoQuality, 80);
        const resolvedQuality = available.find(q => q.id === returnedId || q.label === returnedId)?.id ?? returnedId ?? selected;
        const source: IPlugin.IVideoSourceResult = {
            ...result,
            width: positive(result.width), height: positive(result.height), duration: positive(result.duration),
            timelineId: stableId(result.timelineId), quality: declaredQuality,
        };
        return { candidate: enriched, source, quality: resolvedQuality, isCurrent: () => {
            try {
                this.guard(owner, current, signal); return true;
            } catch {
                return false;
            }
        } };
    }
}
