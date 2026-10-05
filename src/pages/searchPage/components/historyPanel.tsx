import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import Loading from "@/components/base/loading";
import Chip from "@/components/base/chip";
import { useSubmitSearch } from "../hooks/useSearchSession";
import {
    addHistory,
    getHistory,
    removeAllHistory,
    removeHistory,
} from "../common/historySearch";
import ThemeText from "@/components/base/themeText";
import Button from "@/components/base/textButton.tsx";
import Empty from "@/components/base/empty";
import { useI18N } from "@/core/i18n";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import { PAGE_MARGIN } from "@/utils/tileLayout";

export default function () {
    const [history, setHistory] = useState<string[] | null>(null);
    const submitSearch = useSubmitSearch();
    const { t } = useI18N();
    const musicBarBottomInset = useMusicBarFloatingOffset(rpx(24));

    useEffect(() => {
        getHistory().then(setHistory);
    }, []);

    return (
        <View style={style.wrapper}>
            {history === null ? (
                <Loading />
            ) : (
                <>
                    <View style={style.header}>
                        <ThemeText
                            accessibilityRole="header"
                            fontWeight="bold"
                            style={style.headerTitle}>
                            {t("searchPage.history")}
                        </ThemeText>
                        <Button
                            onPress={async () => {
                                await removeAllHistory();
                                getHistory().then(setHistory);
                            }}>
                            {t("common.clear")}
                        </Button>
                    </View>
                    <ScrollView
                        style={style.historyContent}
                        contentContainerStyle={[
                            style.historyContentConainer,
                            {
                                paddingBottom:
                                    musicBarBottomInset || rpx(24),
                            },
                        ]}>
                        {history.length ? (
                            history.map(_ => (
                                <Chip
                                    key={`search-history-${_}`}
                                    containerStyle={style.chip}
                                    closeAccessibilityLabel={t(
                                        "searchPage.history.removeItem.a11y",
                                        { keyword: _ },
                                    )}
                                    onClose={async () => {
                                        await removeHistory(_);
                                        getHistory().then(setHistory);
                                    }}
                                    onPress={() => {
                                        submitSearch(_);
                                        addHistory(_);
                                    }}>
                                    {_}
                                </Chip>
                            ))
                        ) : (
                            <Empty />
                        )}
                    </ScrollView>
                </>
            )}
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        maxWidth: "100%",
        flexDirection: "column",
        paddingHorizontal: PAGE_MARGIN,
        flex: 1,
    },
    header: {
        width: "100%",
        flexDirection: "row",
        paddingTop: 16,
        paddingBottom: 12,
        justifyContent: "space-between",
        alignItems: "baseline",
    },
    headerTitle: {
        fontSize: 20,
        lineHeight: 25,
    },
    historyContent: {
        width: "100%",
        flex: 1,
    },
    historyContentConainer: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    chip: {
        flexGrow: 0,
        marginRight: 10,
        marginBottom: 10,
    },
});
