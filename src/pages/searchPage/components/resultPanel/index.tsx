/**
 * 搜索结果面板 一级页
 */
import React, { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import rpx, { vw } from "@/utils/rpx";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import ResultSubPanel from "./resultSubPanel";
import results from "./results";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";
import { RequestStateCode } from "@/constants/commonConst";
import { useAtomValue } from "jotai";
import { searchResultsAtom } from "../../store/atoms";
import Color from "color";

const routes = results;

const getRouterScene = (
    routes: Array<{ key: ICommon.SupportMediaType; title: string }>,
) => {
    const scene: Record<string, () => JSX.Element> = {};
    routes.forEach(r => {
        scene[r.key] = () => <ResultSubPanel tab={r.key} />;
    });
    return SceneMap(scene);
};

const renderScene = getRouterScene(routes);
const ERROR_COLOR = "#FC5F5F";

function getCategoryTabMeta(
    searchResultMap:
        | Record<
              string,
              {
                  state?: RequestStateCode;
                  data?: unknown[];
              }
          >
        | undefined,
    loadingText: string,
    failedText: string,
) {
    const resultsByPlugin = Object.values(searchResultMap ?? {});
    if (!resultsByPlugin.length) {
        return {
            text: "",
            isError: false,
        };
    }

    const resultCount = resultsByPlugin.reduce(
        (sum, item) => sum + (item?.data?.length ?? 0),
        0,
    );
    const isLoading = resultsByPlugin.some(
        item =>
            item?.state === RequestStateCode.PENDING_FIRST_PAGE ||
            item?.state === RequestStateCode.PENDING_REST_PAGE,
    );
    const isError = resultsByPlugin.some(
        item => item?.state === RequestStateCode.ERROR,
    );
    const hasDoneResult = resultsByPlugin.some(
        item =>
            item?.state === RequestStateCode.FINISHED ||
            item?.state === RequestStateCode.PARTLY_DONE,
    );

    if (isLoading) {
        return {
            text: resultCount ? `${resultCount}...` : loadingText,
            isError: false,
        };
    }
    if (resultCount || hasDoneResult) {
        return {
            text: `${resultCount}`,
            isError: false,
        };
    }
    if (isError) {
        return {
            text: failedText,
            isError: true,
        };
    }

    return {
        text: "",
        isError: false,
    };
}

function ResultPanel() {
    const params = useParams<"search-page">();
    const initialIndex = Math.max(
        routes.findIndex(route => route.key === params?.initialSearchType),
        0,
    );
    const [index, setIndex] = useState(initialIndex);
    const colors = useColors();
    const { t } = useI18N();
    const searchResults = useAtomValue(searchResultsAtom);

    useEffect(() => {
        setIndex(initialIndex);
    }, [initialIndex]);

    return (
        <TabView
            lazy
            navigationState={{
                index,
                routes,
            }}
            renderTabBar={props => {
                const options = props.navigationState.routes.reduce(
                    (acc, route) => {
                        acc[route.key] = {
                            label: ({ focused }: any) => (
                                <CategoryTabLabel
                                    title={
                                        route.i18nKey
                                            ? t(route.i18nKey as any)
                                            : route.title
                                    }
                                    focused={focused}
                                    meta={getCategoryTabMeta(
                                        searchResults[route.key],
                                        t("common.loading"),
                                        t("common.failToLoad"),
                                    )}
                                />
                            ),
                        };
                        return acc;
                    },
                    {} as Record<string, any>,
                );

                return (
                    <TabBar
                        {...props}
                        scrollEnabled
                        style={{
                            backgroundColor: colors.tabBar,
                            shadowColor: "transparent",
                            borderColor: "transparent",
                        }}
                        inactiveColor={colors.text}
                        activeColor={colors.primary}
                        tabStyle={{
                            width: "auto",
                        }}
                        renderIndicator={() => null}
                        pressColor="transparent"
                        options={options}
                    />
                );
            }}
            renderScene={renderScene}
            onIndexChange={setIndex}
            initialLayout={{ width: vw(100) }}
        />
    );
}

function CategoryTabLabel(props: {
    title: string;
    focused: boolean;
    meta: {
        text: string;
        isError: boolean;
    };
}) {
    const { title, focused, meta } = props;
    const colors = useColors();
    const textColor = focused
        ? colors.primary
        : colors.textSecondary ?? colors.text;
    const metaColor = meta.isError
        ? ERROR_COLOR
        : focused
            ? colors.primary
            : colors.textSecondary;

    return (
        <View
            style={[
                styles.categoryTabLabel,
                {
                    backgroundColor: focused
                        ? Color(colors.primary).alpha(0.1).toString()
                        : "transparent",
                    borderColor: focused
                        ? Color(colors.primary).alpha(0.28).toString()
                        : "transparent",
                },
            ]}>
            <Text
                numberOfLines={1}
                style={[
                    styles.categoryTabTitle,
                    {
                        fontWeight: focused
                            ? fontWeightConst.bolder
                            : fontWeightConst.medium,
                        color: textColor,
                    },
                ]}>
                {title}
            </Text>
            {meta.text ? (
                <Text
                    numberOfLines={1}
                    style={[
                        styles.categoryTabMeta,
                        {
                            color: metaColor,
                        },
                    ]}>
                    {meta.text}
                </Text>
            ) : null}
        </View>
    );
}

export default memo(ResultPanel);

const styles = StyleSheet.create({
    categoryTabLabel: {
        width: rpx(156),
        minHeight: rpx(72),
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(8),
        borderRadius: rpx(8),
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        rowGap: rpx(2),
    },
    categoryTabTitle: {
        width: "100%",
        textAlign: "center",
    },
    categoryTabMeta: {
        width: "100%",
        fontSize: fontSizeConst.tag,
        textAlign: "center",
    },
});
