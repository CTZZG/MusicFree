import Icon from "@/components/base/icon.tsx";
import Input from "@/components/base/input";
import ThemeText from "@/components/base/themeText";
import Button from "@/components/base/textButton.tsx";
import { useI18N } from "@/core/i18n";
import searchSession from "@/core/search";
import useColors from "@/hooks/useColors";
import { useAtom, useSetAtom } from "jotai";
import React, { useState } from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";
import { addHistory } from "../common/historySearch";
import { usePageStatus, useSubmitSearch } from "../hooks/useSearchSession";
import { PageStatus, editingAtom, queryAtom } from "../store/atoms";
import { PAGE_MARGIN } from "@/utils/tileLayout";

interface INavBarProps {
    autoFocus?: boolean;
    inputRef?: React.RefObject<TextInput | null>;
}

/**
 * iOS 搜索页头部：没在输入时显示“搜索”大标题；下面是圆角搜索框，
 * 输入或有结果时右侧出现“取消”，点一下回到搜索历史。
 */
export default function NavBar(props: INavBarProps) {
    const { autoFocus, inputRef } = props;
    const submitSearch = useSubmitSearch();
    const [query, setQuery] = useAtom(queryAtom);
    const setEditing = useSetAtom(editingAtom);
    const pageStatus = usePageStatus();
    const [focused, setFocused] = useState(!!autoFocus);
    const colors = useColors();
    const { t } = useI18N();

    const onSearchSubmit = async () => {
        const keyword = query.trim();
        if (keyword === "") {
            return;
        }
        submitSearch(keyword);
        await addHistory(keyword);
    };

    const onCancel = () => {
        inputRef?.current?.blur();
        Keyboard.dismiss();
        searchSession.reset();
        setQuery("");
        setEditing(true);
    };

    const showLargeTitle = !focused && pageStatus === PageStatus.EDITING;
    const showCancel =
        focused || query.length > 0 || pageStatus !== PageStatus.EDITING;

    return (
        <View style={styles.wrapper}>
            {showLargeTitle ? (
                <ThemeText
                    accessibilityRole="header"
                    fontWeight="bold"
                    style={styles.largeTitle}>
                    {t("common.search")}
                </ThemeText>
            ) : null}
            <View style={styles.row}>
                <View
                    style={[
                        styles.field,
                        { backgroundColor: colors.placeholder },
                    ]}>
                    <Icon
                        name="magnifying-glass"
                        size={17}
                        color={colors.textSecondary}
                    />
                    <Input
                        ref={inputRef}
                        autoFocus={autoFocus}
                        hasHorizontalPadding={false}
                        returnKeyType="search"
                        style={[styles.input, { color: colors.text }]}
                        accessible
                        accessibilityLabel={t("searchPage.searchLabel.a11y")}
                        accessibilityHint={t("searchPage.searchPlaceHolder")}
                        placeholderTextColor={colors.textSecondary}
                        placeholder={t("searchPage.searchPlaceHolder")}
                        onFocus={() => {
                            setFocused(true);
                            setEditing(true);
                        }}
                        onBlur={() => {
                            setFocused(false);
                        }}
                        onSubmitEditing={onSearchSubmit}
                        onChangeText={text => {
                            if (text === "") {
                                setEditing(true);
                            }
                            setQuery(text);
                        }}
                        value={query}
                    />
                    {query.length ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("common.clear")}
                            hitSlop={10}
                            onPress={() => {
                                setQuery("");
                                setEditing(true);
                                inputRef?.current?.focus();
                            }}
                            style={[
                                styles.clear,
                                { backgroundColor: colors.textSecondary },
                            ]}>
                            <Icon
                                name="x-mark"
                                size={12}
                                color={colors.pageBackground}
                            />
                        </Pressable>
                    ) : null}
                </View>
                {showCancel ? (
                    <Button style={styles.cancel} onPress={onCancel}>
                        {t("common.cancel")}
                    </Button>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        paddingTop: 12,
        paddingBottom: 8,
    },
    largeTitle: {
        paddingHorizontal: PAGE_MARGIN,
        marginBottom: 10,
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: 0.4,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: PAGE_MARGIN,
    },
    // 输入框（TextInput）的字一直跟着系统字体放大：框只给最小高度，字大了跟着变高
    field: {
        flex: 1,
        minHeight: 36,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        gap: 6,
    },
    // 撑满框的高度，点框里任何地方都能输入。不用 height: "100%"：框只有最小高度，
    // 百分比高度算不出来
    input: {
        flex: 1,
        alignSelf: "stretch",
        paddingVertical: 0,
        fontSize: 17,
    },
    clear: {
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    cancel: {
        paddingLeft: 12,
        paddingVertical: 8,
    },
});
