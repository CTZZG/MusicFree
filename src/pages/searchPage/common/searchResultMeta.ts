import { RequestStateCode } from "@/constants/commonConst";
import type { ISearchSourceResult, SearchSessionPhase } from "@/core/search";
import type { ILanguageData } from "@/types/core/i18n";
import { PageStatus } from "../store/atoms";

type Translate = (
    key: keyof ILanguageData,
    args?: Record<string, unknown>,
) => string;

export interface ITabMeta {
    text: string;
    isError: boolean;
}

export interface ISourceEmptyState {
    title?: string;
    description?: string;
}

const EMPTY_META: ITabMeta = { text: "", isError: false };

function isPending(state: RequestStateCode) {
    return (
        state === RequestStateCode.PENDING_FIRST_PAGE ||
        state === RequestStateCode.PENDING_REST_PAGE
    );
}

function isSettled(state: RequestStateCode) {
    return (
        state === RequestStateCode.FINISHED ||
        state === RequestStateCode.PARTLY_DONE
    );
}

export function getPageStatus(
    editing: boolean,
    phase: SearchSessionPhase,
): PageStatus {
    if (editing || phase === "idle") {
        return PageStatus.EDITING;
    }
    if (phase === "no-source") {
        return PageStatus.NO_PLUGIN;
    }
    // 任意一个来源返回后就展示结果，其余来源在各自的标签里继续加载
    return phase === "pending" ? PageStatus.SEARCHING : PageStatus.RESULT;
}

/** 类别标签（单曲、专辑……）：汇总各来源的结果数，全部失败时提示失败 */
export function getCategoryTabMeta(
    results: Readonly<Record<string, ISearchSourceResult>> | undefined,
    t: Translate,
): ITabMeta {
    const resultsBySource = Object.values(results ?? {});
    if (!resultsBySource.length) {
        return EMPTY_META;
    }

    const resultCount = resultsBySource.reduce(
        (sum, item) => sum + item.data.length,
        0,
    );
    if (resultsBySource.some(item => isPending(item.state))) {
        return {
            text: resultCount ? `${resultCount}...` : t("common.loading"),
            isError: false,
        };
    }
    if (resultCount || resultsBySource.some(item => isSettled(item.state))) {
        return { text: `${resultCount}`, isError: false };
    }
    if (resultsBySource.some(item => item.state === RequestStateCode.ERROR)) {
        return { text: t("common.failToLoad"), isError: true };
    }
    return EMPTY_META;
}

/** 来源标签：失败时区分超时；翻页失败但已有结果时仍显示数量，并标记失败 */
export function getSourceTabMeta(
    result: ISearchSourceResult | undefined,
    t: Translate,
): ITabMeta {
    if (!result) {
        return EMPTY_META;
    }

    const count = result.data.length;
    if (isPending(result.state)) {
        return {
            text: count ? `${count}...` : t("common.loading"),
            isError: false,
        };
    }
    if (result.state === RequestStateCode.ERROR) {
        if (count) {
            return { text: `${count}`, isError: true };
        }
        return {
            text:
                result.failure?.kind === "timeout"
                    ? t("searchPage.sourceTimeoutShort")
                    : t("common.failToLoad"),
            isError: true,
        };
    }
    if (isSettled(result.state)) {
        return { text: `${count}`, isError: false };
    }
    return EMPTY_META;
}

/** 来源没有可展示的结果时的提示，按失败原因说明情况 */
export function getSourceEmptyState(
    result: ISearchSourceResult | undefined,
    sourceName: string,
    t: Translate,
): ISourceEmptyState {
    if (!result) {
        return {};
    }

    const sourceArgs = { source: sourceName };
    if (isSettled(result.state)) {
        return { title: t("searchPage.sourceEmptyResult", sourceArgs) };
    }
    if (result.state !== RequestStateCode.ERROR) {
        return {};
    }

    switch (result.failure?.kind) {
    case "timeout":
        return {
            title: t("searchPage.sourceTimeout", sourceArgs),
            description: t("searchPage.sourceTimeoutDescription"),
        };
    case "source-unavailable":
        return {
            title: t("searchPage.sourceUnavailable", sourceArgs),
            description: t("searchPage.sourceUnavailableDescription"),
        };
    case "invalid-result":
        return {
            title: t("searchPage.sourceLoadFailed", sourceArgs),
            description: t("searchPage.sourceInvalidResult"),
        };
    default:
        return {
            title: t("searchPage.sourceLoadFailed", sourceArgs),
            description: result.failure?.message || undefined,
        };
    }
}
