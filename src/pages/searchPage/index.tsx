import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import NavBar from "./components/navBar";
import { useSetAtom } from "jotai";
import { PageStatus, editingAtom, queryAtom } from "./store/atoms";
import HistoryPanel from "./components/historyPanel";
import ResultPanel from "./components/resultPanel";
import Loading from "@/components/base/loading";
import { SafeAreaView } from "react-native-safe-area-context";
import StatusBar from "@/components/base/statusBar";
import NoPlugin from "../../components/base/noPlugin";
import { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";
import searchSession from "@/core/search";
import { usePageStatus, useSubmitSearch } from "./hooks/useSearchSession";

export default function () {
    const pageStatus = usePageStatus();
    const setEditing = useSetAtom(editingAtom);
    const setQuery = useSetAtom(queryAtom);
    const submitSearch = useSubmitSearch();
    const { t } = useI18N();
    const params = useParams<"search-page">();
    const initialQuery = params?.initialQuery?.trim();

    useEffect(() => {
        if (initialQuery) {
            submitSearch(initialQuery, {
                type: params?.initialSearchType,
                sourceHash: params?.pluginHash,
            });
        }
    }, [
        initialQuery,
        params?.initialSearchType,
        params?.initialSearchToken,
        params?.pluginHash,
        submitSearch,
    ]);

    useEffect(() => {
        return () => {
            // 离开搜索页即结束这次搜索，之后才返回的结果直接丢弃
            searchSession.reset();
            setEditing(true);
            setQuery("");
        };
    }, [setEditing, setQuery]);

    return (
        <SafeAreaView edges={["bottom", "top"]} style={style.wrapper}>
            <StatusBar />
            <NavBar autoFocus={!initialQuery} />
            <SafeAreaView edges={["left", "right"]} style={style.wrapper}>
                <View style={style.flex1}>
                    {pageStatus === PageStatus.EDITING && <HistoryPanel />}
                    {pageStatus === PageStatus.SEARCHING && <Loading />}
                    {pageStatus === PageStatus.RESULT && <ResultPanel />}
                    {pageStatus === PageStatus.NO_PLUGIN && (
                        <NoPlugin notSupportType={t("common.search")} />
                    )}
                </View>
            </SafeAreaView>
        </SafeAreaView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    flex1: {
        flex: 1,
    },
});
