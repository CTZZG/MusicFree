jest.mock("react-native-reanimated", () => ({
    Easing: {
        exp: jest.fn(),
        out: jest.fn((easing: unknown) => easing),
    },
}));

import { RequestStateCode } from "@/constants/commonConst";
import type { ISearchFailure, ISearchSourceResult } from "@/core/search";
import { PageStatus } from "../../store/atoms";
import {
    getCategoryTabMeta,
    getPageStatus,
    getSourceEmptyState,
    getSourceTabMeta,
} from "../searchResultMeta";

const t = (key: string, args?: Record<string, unknown>) =>
    args ? `${key}${JSON.stringify(args)}` : key;

function result(
    state: RequestStateCode,
    count = 0,
    failureInfo?: ISearchFailure,
): ISearchSourceResult {
    return {
        state,
        query: "q",
        page: count ? 1 : 0,
        data: Array.from({ length: count }, (_, i) => ({ id: `${i}` })) as any,
        failure: failureInfo,
    };
}

function failure(
    kind: ISearchFailure["kind"],
    page = 1,
    message = "boom",
): ISearchFailure {
    return { kind, page, message };
}

describe("getPageStatus", () => {
    it("shows history while editing or before any search", () => {
        expect(getPageStatus(true, "settled")).toBe(PageStatus.EDITING);
        expect(getPageStatus(false, "idle")).toBe(PageStatus.EDITING);
    });

    it("waits for the first source, then shows results", () => {
        expect(getPageStatus(false, "pending")).toBe(PageStatus.SEARCHING);
        expect(getPageStatus(false, "settled")).toBe(PageStatus.RESULT);
    });

    it("reports a missing source", () => {
        expect(getPageStatus(false, "no-source")).toBe(PageStatus.NO_PLUGIN);
    });
});

describe("getCategoryTabMeta", () => {
    it("is blank before any source was requested", () => {
        expect(getCategoryTabMeta({}, t)).toEqual({ text: "", isError: false });
    });

    it("shows the count so far while some source is still loading", () => {
        expect(
            getCategoryTabMeta(
                {
                    a: result(RequestStateCode.FINISHED, 3),
                    b: result(RequestStateCode.PENDING_FIRST_PAGE),
                },
                t,
            ),
        ).toEqual({ text: "3...", isError: false });
    });

    it("keeps showing results when only some sources failed", () => {
        expect(
            getCategoryTabMeta(
                {
                    a: result(RequestStateCode.PARTLY_DONE, 2),
                    b: result(
                        RequestStateCode.ERROR,
                        0,
                        failure("timeout"),
                    ),
                },
                t,
            ),
        ).toEqual({ text: "2", isError: false });
    });

    it("reports failure only when every source failed", () => {
        expect(
            getCategoryTabMeta(
                {
                    a: result(RequestStateCode.ERROR, 0, failure("error")),
                    b: result(RequestStateCode.ERROR, 0, failure("timeout")),
                },
                t,
            ),
        ).toEqual({ text: "common.failToLoad", isError: true });
    });
});

describe("getSourceTabMeta", () => {
    it("tells a timeout apart from other failures", () => {
        expect(
            getSourceTabMeta(
                result(RequestStateCode.ERROR, 0, failure("timeout")),
                t,
            ),
        ).toEqual({ text: "searchPage.sourceTimeoutShort", isError: true });
        expect(
            getSourceTabMeta(
                result(RequestStateCode.ERROR, 0, failure("error")),
                t,
            ),
        ).toEqual({ text: "common.failToLoad", isError: true });
    });

    it("keeps the loaded count when a later page failed", () => {
        expect(
            getSourceTabMeta(
                result(RequestStateCode.ERROR, 20, failure("error", 2)),
                t,
            ),
        ).toEqual({ text: "20", isError: true });
    });

    it("shows loading and finished counts", () => {
        expect(
            getSourceTabMeta(result(RequestStateCode.PENDING_FIRST_PAGE), t),
        ).toEqual({ text: "common.loading", isError: false });
        expect(
            getSourceTabMeta(result(RequestStateCode.PENDING_REST_PAGE, 20), t),
        ).toEqual({ text: "20...", isError: false });
        expect(
            getSourceTabMeta(result(RequestStateCode.FINISHED, 0), t),
        ).toEqual({ text: "0", isError: false });
        expect(getSourceTabMeta(undefined, t)).toEqual({
            text: "",
            isError: false,
        });
    });
});

describe("getSourceEmptyState", () => {
    const source = JSON.stringify({ source: "Src" });

    it("explains each failure kind", () => {
        expect(
            getSourceEmptyState(
                result(RequestStateCode.ERROR, 0, failure("timeout")),
                "Src",
                t,
            ),
        ).toEqual({
            title: `searchPage.sourceTimeout${source}`,
            description: "searchPage.sourceTimeoutDescription",
        });
        expect(
            getSourceEmptyState(
                result(
                    RequestStateCode.ERROR,
                    0,
                    failure("source-unavailable"),
                ),
                "Src",
                t,
            ),
        ).toEqual({
            title: `searchPage.sourceUnavailable${source}`,
            description: "searchPage.sourceUnavailableDescription",
        });
        expect(
            getSourceEmptyState(
                result(RequestStateCode.ERROR, 0, failure("invalid-result")),
                "Src",
                t,
            ),
        ).toEqual({
            title: `searchPage.sourceLoadFailed${source}`,
            description: "searchPage.sourceInvalidResult",
        });
        expect(
            getSourceEmptyState(
                result(
                    RequestStateCode.ERROR,
                    0,
                    failure("error", 1, "plugin exploded"),
                ),
                "Src",
                t,
            ),
        ).toEqual({
            title: `searchPage.sourceLoadFailed${source}`,
            description: "plugin exploded",
        });
    });

    it("says a finished source had no results", () => {
        expect(
            getSourceEmptyState(result(RequestStateCode.FINISHED), "Src", t),
        ).toEqual({ title: `searchPage.sourceEmptyResult${source}` });
    });

    it("has nothing to say while loading", () => {
        expect(
            getSourceEmptyState(
                result(RequestStateCode.PENDING_FIRST_PAGE),
                "Src",
                t,
            ),
        ).toEqual({});
        expect(getSourceEmptyState(undefined, "Src", t)).toEqual({});
    });
});
