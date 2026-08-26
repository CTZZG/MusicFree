import { Linking } from "react-native";
import { URLSearchParams } from "react-native-url-polyfill";

import Config from "@/core/appConfig";
import SecureCredential, {
    setCredentialVerified,
} from "@/native/secureCredential";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { errorLog, trace } from "@/utils/log";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";

import { buildApiSignature } from "./signature";
import {
    accumulateListenedSeconds,
    appendPendingScrobble,
    buildNowPlayingParams,
    buildScrobbleBatchParams,
    isScrobbleEligible,
    MAX_SCROBBLE_BATCH,
    toScrobbleEntry,
    type ScrobbleEntry,
} from "./scrobblePolicy";

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const AUTH_PAGE = "https://www.last.fm/api/auth/";
const REQUEST_TIMEOUT_MS = 10_000;

export const LASTFM_SECRET_CREDENTIAL_KEY = "lastfm.apiSecret";
export const LASTFM_SESSION_CREDENTIAL_KEY = "lastfm.sessionKey";

const scrobbleStore = getOrCreateMMKV("App.lastfm");
const PENDING_KEY = "pending";

const httpClient = createRestrictedHttpClient({
    maxTimeoutMs: REQUEST_TIMEOUT_MS,
    maxResponseBytes: 512 * 1024,
});

interface LastfmErrorPayload {
    error?: number;
    message?: string;
}

/**
 * Last.fm 用 HTTP 200 + body 里的 error 码来报错，不能只看状态码。
 * 6/7/9/13 这几个是「这条请求本身没救了」，重试多少次都一样，必须直接丢弃，
 * 否则一条坏数据会永远卡在离线队列头部，把后面正常的记录全堵死。
 */
const PERMANENT_ERROR_CODES = new Set([
    4, // Authentication Failed
    6, // Invalid parameters
    7, // Invalid resource specified
    9, // Invalid session key
    13, // Invalid method signature
]);

export interface LastfmStatus {
    configured: boolean;
    authorized: boolean;
    username: string | null;
    pendingCount: number;
}

interface PlaybackSession {
    entry: ScrobbleEntry;
    listenedSeconds: number;
    lastTickAt: number;
    nowPlayingSentAt: number | null;
    nowPlayingInFlight: boolean;
    scrobbled: boolean;
}

class LastfmScrobbler {
    private session: PlaybackSession | null = null;
    private flushing = false;
    private cachedApiSecret: string | null = null;
    private cachedSessionKey: string | null = null;
    private credentialsLoaded = false;

    /**************** 配置与凭据 ****************/

    isEnabled() {
        return Config.getConfig("lastfm.enabled") === true;
    }

    getApiKey() {
        return (Config.getConfig("lastfm.apiKey") ?? "").trim();
    }

    getUsername() {
        return Config.getConfig("lastfm.username") ?? null;
    }

    private async loadCredentials() {
        if (this.credentialsLoaded) {
            return;
        }
        try {
            this.cachedApiSecret = await SecureCredential.getCredential(
                LASTFM_SECRET_CREDENTIAL_KEY,
            );
            this.cachedSessionKey = await SecureCredential.getCredential(
                LASTFM_SESSION_CREDENTIAL_KEY,
            );
            this.credentialsLoaded = true;
        } catch (error: any) {
            // 安全存储不可用时不缓存「读不到」这个结论，下次还要重试，
            // 否则一次启动期抖动会让 scrobble 静默瘫痪整个会话。
            errorLog("Last.fm 凭据读取失败", error?.message ?? error);
        }
    }

    async setApiSecret(secret: string) {
        await setCredentialVerified(LASTFM_SECRET_CREDENTIAL_KEY, secret);
        this.cachedApiSecret = secret;
        this.credentialsLoaded = true;
    }

    async hasApiSecret() {
        await this.loadCredentials();
        return Boolean(this.cachedApiSecret);
    }

    async getStatus(): Promise<LastfmStatus> {
        await this.loadCredentials();
        return {
            configured: Boolean(this.getApiKey() && this.cachedApiSecret),
            authorized: Boolean(this.cachedSessionKey),
            username: this.getUsername(),
            pendingCount: this.readPending().length,
        };
    }

    async signOut() {
        try {
            await SecureCredential.deleteCredential(
                LASTFM_SESSION_CREDENTIAL_KEY,
            );
        } catch (error: any) {
            errorLog("Last.fm 注销失败", error?.message ?? error);
        }
        this.cachedSessionKey = null;
        Config.setConfig("lastfm.username", undefined);
    }

    /**************** 授权 ****************/

    /**
     * 第一步：申请一个 request token 并把用户送去浏览器授权。
     * Last.fm 没有给移动端的自动回跳（回调地址是注册应用时固定的网页地址），
     * 所以这里只能走「浏览器里点同意，回到 App 再点完成」的两段式。
     */
    async beginAuthorization(): Promise<string> {
        const token = await this.callSigned<{ token?: string }>(
            "auth.getToken",
            {},
            "GET",
        );
        if (!token?.token) {
            throw new Error("Last.fm 未返回授权 token");
        }
        const apiKey = this.getApiKey();
        await Linking.openURL(
            `${AUTH_PAGE}?api_key=${encodeURIComponent(
                apiKey,
            )}&token=${encodeURIComponent(token.token)}`,
        );
        return token.token;
    }

    /** 第二步：用户在浏览器点过同意之后，拿 token 换长期 session key。 */
    async completeAuthorization(token: string): Promise<string> {
        const result = await this.callSigned<{
            session?: { name?: string; key?: string };
        }>("auth.getSession", { token }, "GET");
        const sessionKey = result?.session?.key;
        const username = result?.session?.name;
        if (!sessionKey) {
            throw new Error("Last.fm 未返回 session key");
        }
        await setCredentialVerified(
            LASTFM_SESSION_CREDENTIAL_KEY,
            sessionKey,
        );
        this.cachedSessionKey = sessionKey;
        this.credentialsLoaded = true;
        if (username) {
            Config.setConfig("lastfm.username", username);
        }
        return username ?? "";
    }

    /**************** 播放接线 ****************/

    /**
     * 一首歌开始播放。会先把上一首结算掉——自然切歌时不保证有单独的「结束」
     * 事件，只能靠下一首的开始来触发上一首的判定。
     */
    onTrackStarted(musicItem: IMusic.IMusicItem | null | undefined) {
        this.finalizeCurrentSession();
        if (!this.isEnabled() || !musicItem) {
            this.session = null;
            return;
        }
        const entry = toScrobbleEntry(musicItem, Date.now() / 1000);
        if (!entry) {
            this.session = null;
            return;
        }
        this.session = {
            entry,
            listenedSeconds: 0,
            lastTickAt: Date.now(),
            nowPlayingSentAt: null,
            nowPlayingInFlight: false,
            scrobbled: false,
        };
        // now playing 故意不在这里发。启动恢复、乐观预切等路径都会走到这，
        // 那时候曲目未必真的在出声；进度事件只在真播的时候才来，用它当
        // 「确实开始放了」的信号，避免在用户主页上挂一首根本没播的歌。
    }

    /** 进度推进；只按墙上时钟累加真实收听时长，不看播放位置。 */
    onProgressTick() {
        const session = this.session;
        if (!session || !this.isEnabled()) {
            return;
        }
        const now = Date.now();
        const elapsedSeconds = (now - session.lastTickAt) / 1000;
        session.lastTickAt = now;
        session.listenedSeconds = accumulateListenedSeconds(
            session.listenedSeconds,
            elapsedSeconds,
        );

        // 首次收到进度 = 确实开始出声了，这时才上报 now playing；
        // 之后每几分钟刷新一次，否则 Last.fm 页面上会自己掉下去。
        if (
            session.nowPlayingSentAt === null ||
            now - session.nowPlayingSentAt > 4 * 60 * 1000
        ) {
            this.sendNowPlaying().catch(() => undefined);
        }
    }

    /** 暂停：把时钟停住，避免暂停时间被算成收听时长。 */
    onPaused() {
        if (this.session) {
            this.session.lastTickAt = Date.now();
        }
    }

    onResumed() {
        if (this.session) {
            this.session.lastTickAt = Date.now();
        }
    }

    /** 播放彻底停下（退出、清空队列）时结算当前这首。 */
    onPlaybackStopped() {
        this.finalizeCurrentSession();
        this.session = null;
    }

    private finalizeCurrentSession() {
        const session = this.session;
        if (!session || session.scrobbled) {
            return;
        }
        const eligible = isScrobbleEligible({
            duration: session.entry.duration ?? 0,
            listenedSeconds: session.listenedSeconds,
        });
        if (!eligible) {
            return;
        }
        session.scrobbled = true;
        this.enqueue(session.entry);
        this.flush().catch(() => undefined);
    }

    /**************** 队列 ****************/

    private readPending(): ScrobbleEntry[] {
        const raw = scrobbleStore.getString(PENDING_KEY);
        if (!raw) {
            return [];
        }
        const parsed = safeParse(raw);
        return Array.isArray(parsed) ? (parsed as ScrobbleEntry[]) : [];
    }

    private writePending(entries: ScrobbleEntry[]) {
        scrobbleStore.set(PENDING_KEY, safeStringify(entries));
    }

    private enqueue(entry: ScrobbleEntry) {
        this.writePending(appendPendingScrobble(this.readPending(), entry));
    }

    getPendingCount() {
        return this.readPending().length;
    }

    clearPending() {
        this.writePending([]);
    }

    /**
     * 把离线队列冲出去。整批成功才出队；遇到「永久失败」的错误码也要出队，
     * 否则这批数据会一直卡在队首无限重试。网络类失败保持原样，下次再来。
     */
    async flush(): Promise<void> {
        if (this.flushing || !this.isEnabled()) {
            return;
        }
        await this.loadCredentials();
        if (!this.cachedSessionKey || !this.getApiKey()) {
            return;
        }

        this.flushing = true;
        try {
            while (true) {
                const pending = this.readPending();
                if (!pending.length) {
                    return;
                }
                const batch = pending.slice(0, MAX_SCROBBLE_BATCH);
                try {
                    await this.callSigned(
                        "track.scrobble",
                        buildScrobbleBatchParams(batch),
                        "POST",
                        true,
                    );
                } catch (error: any) {
                    if (!error?.lastfmPermanent) {
                        trace("Last.fm scrobble 稍后重试", {
                            pending: pending.length,
                        });
                        return;
                    }
                    errorLog(
                        "Last.fm 丢弃无法提交的 scrobble",
                        error?.message ?? error,
                    );
                }
                this.writePending(pending.slice(batch.length));
            }
        } finally {
            this.flushing = false;
        }
    }

    private async sendNowPlaying() {
        const session = this.session;
        if (
            !session ||
            session.nowPlayingInFlight ||
            Config.getConfig("lastfm.nowPlaying") === false
        ) {
            return;
        }
        session.nowPlayingInFlight = true;
        try {
            await this.loadCredentials();
            if (!this.cachedSessionKey || !this.getApiKey()) {
                return;
            }
            await this.callSigned(
                "track.updateNowPlaying",
                buildNowPlayingParams(session.entry),
                "POST",
                true,
            );
            session.nowPlayingSentAt = Date.now();
        } catch (error: any) {
            // now playing 丢了就丢了，不进队列不重试——它是个瞬时状态，
            // 补发一条几分钟前的「正在播放」只会让用户主页显示错的东西。
            trace("Last.fm now playing 更新失败", {
                message: error?.message,
            });
        } finally {
            session.nowPlayingInFlight = false;
        }
    }

    /**************** 底层请求 ****************/

    private async callSigned<T = any>(
        method: string,
        params: Record<string, string>,
        httpMethod: "GET" | "POST",
        withSession = false,
    ): Promise<T> {
        await this.loadCredentials();
        const apiKey = this.getApiKey();
        const apiSecret = this.cachedApiSecret;
        if (!apiKey || !apiSecret) {
            throw new Error("Last.fm API key / secret 未配置");
        }

        const signedParams: Record<string, string> = {
            ...params,
            method,
            api_key: apiKey,
        };
        if (withSession) {
            if (!this.cachedSessionKey) {
                throw new Error("Last.fm 尚未授权");
            }
            signedParams.sk = this.cachedSessionKey;
        }
        signedParams.api_sig = buildApiSignature(signedParams, apiSecret);

        const body = new URLSearchParams({
            ...signedParams,
            format: "json",
        }).toString();

        const response =
            httpMethod === "GET"
                ? await httpClient.get(`${API_ROOT}?${body}`)
                : await httpClient.post(API_ROOT, body, {
                    headers: {
                        "Content-Type":
                              "application/x-www-form-urlencoded",
                    },
                });

        const data = response?.data as (T & LastfmErrorPayload) | undefined;
        if (data && typeof data.error === "number") {
            const error: any = new Error(
                data.message || `Last.fm 错误 ${data.error}`,
            );
            error.lastfmCode = data.error;
            error.lastfmPermanent = PERMANENT_ERROR_CODES.has(data.error);
            // session key 失效必须清掉，否则会拿着废 key 反复失败，
            // 用户界面上还显示「已授权」。
            if (data.error === 9) {
                this.cachedSessionKey = null;
                SecureCredential.deleteCredential(
                    LASTFM_SESSION_CREDENTIAL_KEY,
                ).catch(() => undefined);
                Config.setConfig("lastfm.username", undefined);
            }
            throw error;
        }
        return data as T;
    }
}

const lastfmScrobbler = new LastfmScrobbler();
export default lastfmScrobbler;
