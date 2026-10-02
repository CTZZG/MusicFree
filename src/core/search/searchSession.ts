import { RequestStateCode } from "@/constants/commonConst";
import { devLog, errorLog, trace } from "@/utils/log";
import { isTimeoutError, withTimeout } from "@/utils/promiseTimeout";
import {
    getSearchRequestKey,
    getSearchRequestSignature,
    ISearchRequestToken,
    SearchRequestGuard,
} from "./searchRequestGuard";

/**
 * 单个来源单次请求的等待上限。
 *
 * 插件的 search 没有取消能力：超时或被新请求取代后，只是不再等待它，
 * 插件内部发起的网络请求仍会继续，之后返回的结果会被丢弃。
 */
export const SEARCH_SOURCE_TIMEOUT_MS = 15_000;

const SEARCH_TIMEOUT_MESSAGE = "搜索超时";
const INVALID_RESULT_MESSAGE = "搜索结果为空";
const SOURCE_UNAVAILABLE_MESSAGE = "搜索来源不可用";

/** 搜索会话依赖的来源能力；生产环境由插件提供，测试中可以换成可控的假来源。 */
export interface ISearchSource {
    /** 来源身份，结果按它分组 */
    readonly hash: string;
    readonly name: string;
    /** 未指定搜索类型时，这个来源使用的类型 */
    readonly defaultSearchType?: ICommon.SupportMediaType;
    search<T extends ICommon.SupportMediaType>(
        query: string,
        page: number,
        type: T,
    ): Promise<IPlugin.ISearchResult<T> | null | undefined>;
}

export interface ISearchSourceProvider {
    /** 不限定来源时参与搜索的全部来源 */
    getSearchableSources(): Array<ISearchSource | null | undefined>;
    getSourceByHash(hash: string): ISearchSource | null | undefined;
}

export type SearchFailureKind =
    /** 超过等待上限仍未返回 */
    | "timeout"
    /** 来源抛出了异常 */
    | "error"
    /** 来源返回了空值，或结果里没有 data 数组 */
    | "invalid-result"
    /** 来源已被卸载或停用 */
    | "source-unavailable";

export interface ISearchFailure {
    kind: SearchFailureKind;
    message: string;
    /** 失败请求的页码；重试会重新请求这一页 */
    page: number;
}

/** 一个来源在一种搜索类型下的结果 */
export interface ISearchSourceResult<
    T extends ICommon.SupportMediaType = ICommon.SupportMediaType,
> {
    state: RequestStateCode;
    query: string;
    /** 最后一个成功加载的页码；还没有成功加载过时为 0 */
    page: number;
    /** 已成功加载的各页结果，按页序拼接 */
    data: ICommon.SupportMediaItemBase[T][];
    /** state 为 ERROR 时存在 */
    failure?: ISearchFailure;
}

export type SearchResultsByType = {
    readonly [K in ICommon.SupportMediaType]: Readonly<
        Record<string, ISearchSourceResult<K>>
    >;
};

/**
 * - idle：没有进行中的搜索
 * - no-source：没有可用的搜索来源
 * - pending：已经开始，还没有任何来源返回
 * - settled：至少一个来源已经返回（有结果、无结果或失败）
 */
export type SearchSessionPhase = "idle" | "no-source" | "pending" | "settled";

export interface ISearchSessionSnapshot {
    /** 每次 start / reset 都会递增，用来区分不同的搜索 */
    readonly id: number;
    readonly query: string;
    readonly phase: SearchSessionPhase;
    readonly results: SearchResultsByType;
}

export interface ISearchStartOptions {
    /** 搜索类型；不指定时每个来源使用自己的默认类型 */
    type?: ICommon.SupportMediaType;
    /** 只搜索这一个来源 */
    sourceHash?: string;
}

type PageOutcome =
    | {
          ok: true;
          result: IPlugin.ISearchResult<ICommon.SupportMediaType>;
      }
    | {
          ok: false;
          failure: ISearchFailure;
          error?: unknown;
      };

export function createEmptySearchResults(): SearchResultsByType {
    return {
        music: {},
        album: {},
        artist: {},
        sheet: {},
        lyric: {},
    };
}

/** 开始请求第 page 页：第一页清空旧结果，后续页保留已加载的结果 */
export function toPendingResult(
    previous: ISearchSourceResult | undefined,
    query: string,
    page: number,
): ISearchSourceResult {
    if (page <= 1 || !previous) {
        return {
            state: RequestStateCode.PENDING_FIRST_PAGE,
            query,
            page: 0,
            data: [],
        };
    }
    return {
        state: RequestStateCode.PENDING_REST_PAGE,
        query,
        page: previous.page,
        data: previous.data,
    };
}

export function toSucceededResult(
    previous: ISearchSourceResult | undefined,
    query: string,
    page: number,
    result: IPlugin.ISearchResult<ICommon.SupportMediaType>,
): ISearchSourceResult {
    const items = result.data;
    // 空页即使声明了还有更多也视为结束，避免无限翻空页
    const hasMore = result.isEnd === false && items.length > 0;
    return {
        state: hasMore
            ? RequestStateCode.PARTLY_DONE
            : RequestStateCode.FINISHED,
        query,
        page,
        data: page <= 1 ? items : [...(previous?.data ?? []), ...items],
    };
}

/** 后续页失败时保留已加载的页，page 仍指向最后一个成功的页 */
export function toFailedResult(
    previous: ISearchSourceResult | undefined,
    query: string,
    failure: ISearchFailure,
): ISearchSourceResult {
    if (previous && failure.page > 1) {
        return {
            state: RequestStateCode.ERROR,
            query,
            page: previous.page,
            data: previous.data,
            failure,
        };
    }
    return {
        state: RequestStateCode.ERROR,
        query,
        page: 0,
        data: [],
        failure,
    };
}

export function toSearchFailure(error: unknown, page: number): ISearchFailure {
    return {
        kind: isTimeoutError(error) ? "timeout" : "error",
        message: getErrorMessage(error),
        page,
    };
}

function getErrorMessage(error: unknown) {
    const message = (error as { message?: unknown } | null | undefined)
        ?.message;
    if (typeof message === "string") {
        return message;
    }
    return String(error ?? "");
}

/**
 * 一次搜索的请求编排：关键词、参与的来源、每个来源每种类型的分页与成败。
 *
 * 页面只读取快照、调用这里的操作，不直接调用插件；
 * 每个来源独立加载、独立失败、独立重试，一个来源慢或失败不影响其他来源的结果。
 */
export class SearchSession {
    private readonly provider: ISearchSourceProvider;
    private readonly timeoutMs: number;
    private readonly guard = new SearchRequestGuard();
    private readonly listeners = new Set<() => void>();
    private snapshot: ISearchSessionSnapshot = {
        id: 0,
        query: "",
        phase: "idle",
        results: createEmptySearchResults(),
    };

    constructor(
        provider: ISearchSourceProvider,
        options: { timeoutMs?: number } = {},
    ) {
        this.provider = provider;
        this.timeoutMs = options.timeoutMs ?? SEARCH_SOURCE_TIMEOUT_MS;
    }

    getSnapshot = (): ISearchSessionSnapshot => this.snapshot;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getResult<T extends ICommon.SupportMediaType>(
        type: T,
        sourceHash: string,
    ): ISearchSourceResult<T> | undefined {
        return this.snapshot.results[type][sourceHash] as
            | ISearchSourceResult<T>
            | undefined;
    }

    /**
     * 开始一次新的搜索。之前的请求全部失效：它们迟到的结果和错误都会被丢弃，
     * 不会出现在这次搜索里。
     */
    start(query: string, options: ISearchStartOptions = {}) {
        this.guard.reset();
        const sources = (
            options.sourceHash
                ? [this.provider.getSourceByHash(options.sourceHash)]
                : this.provider.getSearchableSources()
        ).filter((source): source is ISearchSource => !!source?.hash);

        this.commit({
            id: this.snapshot.id + 1,
            query,
            phase: sources.length ? "pending" : "no-source",
            results: createEmptySearchResults(),
        });
        sources.forEach(source => {
            this.request(
                options.type ?? source.defaultSearchType ?? "music",
                source,
                1,
            );
        });
    }

    /** 结束当前搜索并清空结果，例如离开搜索页时 */
    reset() {
        this.guard.reset();
        this.commit({
            id: this.snapshot.id + 1,
            query: "",
            phase: "idle",
            results: createEmptySearchResults(),
        });
    }

    /** 结果第一次展示时调用：本次搜索还没请求过这个来源的这类结果时，请求第一页 */
    ensureLoaded(type: ICommon.SupportMediaType, sourceHash: string) {
        if (this.isActive() && !this.getResult(type, sourceHash)) {
            this.requestByHash(type, sourceHash, 1);
        }
    }

    /** 上一页成功且还有更多结果时加载下一页；请求进行中、已到末尾或失败时不做任何事 */
    loadMore(type: ICommon.SupportMediaType, sourceHash: string) {
        const current = this.getResult(type, sourceHash);
        if (!current) {
            this.ensureLoaded(type, sourceHash);
            return;
        }
        if (this.isActive() && current.state === RequestStateCode.PARTLY_DONE) {
            this.requestByHash(type, sourceHash, current.page + 1);
        }
    }

    /** 重新请求失败的那一页，已经加载的结果保留 */
    retry(type: ICommon.SupportMediaType, sourceHash: string) {
        const current = this.getResult(type, sourceHash);
        if (this.isActive() && current?.state === RequestStateCode.ERROR) {
            this.requestByHash(type, sourceHash, current.failure?.page ?? 1);
        }
    }

    /** 从第一页重新加载，例如下拉刷新 */
    refresh(type: ICommon.SupportMediaType, sourceHash: string) {
        if (this.isActive()) {
            this.requestByHash(type, sourceHash, 1);
        }
    }

    private isActive() {
        return (
            this.snapshot.phase === "pending" ||
            this.snapshot.phase === "settled"
        );
    }

    private requestByHash(
        type: ICommon.SupportMediaType,
        sourceHash: string,
        page: number,
    ) {
        const source = this.provider.getSourceByHash(sourceHash);
        if (source?.hash === sourceHash) {
            this.request(type, source, page);
            return;
        }
        // 来源已被卸载或停用：让这个位置上仍在进行的请求失效，并给出可解释的失败
        this.guard.begin(getSearchRequestKey(type, sourceHash));
        const query = this.snapshot.query;
        this.applyResult(
            type,
            sourceHash,
            previous =>
                toFailedResult(previous, query, {
                    kind: "source-unavailable",
                    message: SOURCE_UNAVAILABLE_MESSAGE,
                    page,
                }),
            true,
        );
    }

    private request(
        type: ICommon.SupportMediaType,
        source: ISearchSource,
        page: number,
    ) {
        const query = this.snapshot.query;
        const signature = getSearchRequestSignature(
            type,
            source.hash,
            query,
            page,
        );
        if (this.guard.isInFlight(signature)) {
            return;
        }
        const token = this.guard.begin(
            getSearchRequestKey(type, source.hash),
            signature,
        );
        trace("开始搜索", {
            source: source.name,
            query,
            page,
            type,
        });
        this.applyResult(type, source.hash, previous =>
            toPendingResult(previous, query, page),
        );
        // 不等待：每个来源各自返回，互不阻塞
        this.execute(type, source, query, page, token);
    }

    private async execute(
        type: ICommon.SupportMediaType,
        source: ISearchSource,
        query: string,
        page: number,
        token: ISearchRequestToken,
    ) {
        const outcome = await this.fetchPage(type, source, query, page);
        this.guard.finish(token);
        if (!this.guard.isCurrent(token)) {
            // 已被新的搜索或同一位置上更新的请求取代
            return;
        }
        if (!outcome.ok) {
            errorLog("搜索失败", outcome.failure.message);
            devLog(
                "error",
                "搜索失败",
                `Plugin: ${source.name} Query: ${query} Page: ${page}`,
                outcome.error,
                outcome.failure.message,
            );
        }
        this.applyResult(
            type,
            source.hash,
            previous =>
                outcome.ok
                    ? toSucceededResult(previous, query, page, outcome.result)
                    : toFailedResult(previous, query, outcome.failure),
            true,
        );
    }

    private async fetchPage(
        type: ICommon.SupportMediaType,
        source: ISearchSource,
        query: string,
        page: number,
    ): Promise<PageOutcome> {
        try {
            const result = await withTimeout(
                source.search(query, page, type),
                this.timeoutMs,
                SEARCH_TIMEOUT_MESSAGE,
            );
            if (!result || !Array.isArray(result.data)) {
                return {
                    ok: false,
                    failure: {
                        kind: "invalid-result",
                        message: INVALID_RESULT_MESSAGE,
                        page,
                    },
                };
            }
            return { ok: true, result };
        } catch (error) {
            return {
                ok: false,
                failure: toSearchFailure(error, page),
                error,
            };
        }
    }

    private applyResult(
        type: ICommon.SupportMediaType,
        sourceHash: string,
        update: (
            previous: ISearchSourceResult | undefined,
        ) => ISearchSourceResult,
        settles = false,
    ) {
        const { results, phase } = this.snapshot;
        const typeResults = results[type] as Readonly<
            Record<string, ISearchSourceResult>
        >;
        this.commit({
            ...this.snapshot,
            phase: settles && phase === "pending" ? "settled" : phase,
            results: {
                ...results,
                [type]: {
                    ...typeResults,
                    [sourceHash]: update(typeResults[sourceHash]),
                },
            },
        });
    }

    private commit(next: ISearchSessionSnapshot) {
        this.snapshot = next;
        this.listeners.forEach(listener => listener());
    }
}
