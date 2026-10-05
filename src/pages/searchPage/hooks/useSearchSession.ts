import searchSession, {
    type ISearchSessionSnapshot,
    type ISearchSourceResult,
    type ISearchStartOptions,
} from "@/core/search";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useSyncExternalStore } from "react";
import { getPageStatus } from "../common/searchResultMeta";
import { editingAtom, queryAtom } from "../store/atoms";

/** 只订阅快照中的一部分；选出的值没变时组件不会重新渲染 */
function useSearchSessionValue<T>(
    select: (snapshot: ISearchSessionSnapshot) => T,
): T {
    const getValue = () => select(searchSession.getSnapshot());
    return useSyncExternalStore(searchSession.subscribe, getValue, getValue);
}

export function useSearchSessionId() {
    return useSearchSessionValue(snapshot => snapshot.id);
}

export function useSearchResults() {
    return useSearchSessionValue(snapshot => snapshot.results);
}

export function useSearchTypeResults<T extends ICommon.SupportMediaType>(type: T) {
    return useSearchSessionValue(
        snapshot =>
            snapshot.results[type] as Readonly<
                Record<string, ISearchSourceResult<T>>
            >,
    );
}

export function useSearchSourceResult<T extends ICommon.SupportMediaType>(
    type: T,
    sourceHash: string,
) {
    return useSearchSessionValue(
        snapshot =>
            snapshot.results[type][sourceHash] as
                | ISearchSourceResult<T>
                | undefined,
    );
}

export function usePageStatus() {
    const editing = useAtomValue(editingAtom);
    const phase = useSearchSessionValue(snapshot => snapshot.phase);
    return getPageStatus(editing, phase);
}

/** 提交搜索：结束编辑状态，用新的关键词开始一次搜索 */
export function useSubmitSearch() {
    const setQuery = useSetAtom(queryAtom);
    const setEditing = useSetAtom(editingAtom);

    return useCallback(
        (query: string, options?: ISearchStartOptions) => {
            // 先开始新的搜索，再退出编辑状态，避免短暂露出上一次搜索的结果
            searchSession.start(query, options);
            setQuery(query);
            setEditing(false);
        },
        [setEditing, setQuery],
    );
}
