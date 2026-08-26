import { RequestStateCode } from "@/constants/commonConst";
import PluginManager from "@/core/pluginManager";
import { resetMediaItem } from "@/utils/mediaUtils";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { createRecommendScopeKey } from "./recommendScope";

export default function (pluginHash: string, tag: ICommon.IUnique) {
    const [sheets, setSheets] = useState<IMusic.IMusicSheetItemBase[]>([]);
    const [requestState, setRequestState] = useState(RequestStateCode.IDLE);
    const tagRef = useRef(tag);
    tagRef.current = tag;
    const scopeKey = createRecommendScopeKey(pluginHash, tag);
    const currentScopeRef = useRef("");
    const generationRef = useRef(0);
    const requestIdRef = useRef(0);
    const nextPageRef = useRef(1);
    const finishedRef = useRef(false);
    const mountedRef = useRef(true);
    const inFlightRef = useRef<{
        scopeKey: string;
        generation: number;
        requestId: number;
    } | null>(null);

    useLayoutEffect(() => {
        if (currentScopeRef.current === scopeKey) {
            return;
        }
        currentScopeRef.current = scopeKey;
        generationRef.current++;
        nextPageRef.current = 1;
        finishedRef.current = false;
        inFlightRef.current = null;
        setSheets([]);
        setRequestState(RequestStateCode.IDLE);
    }, [scopeKey]);

    const query = useCallback(async () => {
        if (finishedRef.current || inFlightRef.current?.scopeKey === scopeKey) {
            return;
        }

        const generation = generationRef.current;
        const requestId = ++requestIdRef.current;
        const page = nextPageRef.current;
        inFlightRef.current = {
            scopeKey,
            generation,
            requestId,
        };
        setRequestState(
            page === 1
                ? RequestStateCode.PENDING_FIRST_PAGE
                : RequestStateCode.PENDING_REST_PAGE,
        );

        const isCurrentRequest = () =>
            mountedRef.current &&
            currentScopeRef.current === scopeKey &&
            generationRef.current === generation &&
            inFlightRef.current?.requestId === requestId;

        try {
            const plugin = PluginManager.getByHash(pluginHash);
            if (!plugin?.methods?.getRecommendSheetsByTag) {
                if (!isCurrentRequest()) {
                    return;
                }
                finishedRef.current = true;
                setRequestState(RequestStateCode.FINISHED);
                setSheets([]);
                return;
            }

            const result = await plugin.methods.getRecommendSheetsByTag(
                tagRef.current,
                page,
            );
            if (!isCurrentRequest()) {
                return;
            }

            const items = (result.data ?? []).map(item =>
                resetMediaItem(item, plugin.instance.platform),
            );
            setSheets(previous =>
                page === 1 ? items : previous.concat(items),
            );
            nextPageRef.current = page + 1;
            finishedRef.current = Boolean(result.isEnd);
            setRequestState(
                result.isEnd
                    ? RequestStateCode.FINISHED
                    : RequestStateCode.PARTLY_DONE,
            );
        } catch {
            if (!isCurrentRequest()) {
                return;
            }
            setRequestState(RequestStateCode.ERROR);
        } finally {
            if (inFlightRef.current?.requestId === requestId) {
                inFlightRef.current = null;
            }
        }
    }, [pluginHash, scopeKey]);

    useEffect(() => {
        query();
    }, [query]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            inFlightRef.current = null;
        };
    }, []);

    return [query, sheets, requestState] as const;
}
