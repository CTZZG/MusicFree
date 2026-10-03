import { HOME_TAB } from "@/core/router";
import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import useColors from "@/hooks/useColors";
import ThemeText from "@/components/base/themeText";
import Icon from "@/components/base/icon.tsx";
import { useI18N } from "@/core/i18n";

/** 首页顶部的搜索框：点一下切到搜索标签 */
export default function NavBar() {
    const navigation = useNavigation<any>();
    const colors = useColors();
    const { t } = useI18N();

    return (
        <View style={styles.appbar}>
            <Pressable
                style={[
                    styles.searchBar,
                    {
                        backgroundColor: colors.placeholder,
                    },
                ]}
                accessible
                accessibilityRole="search"
                accessibilityLabel={t("home.clickToSearch")}
                onPress={() => {
                    navigation.navigate(HOME_TAB.SEARCH);
                }}>
                <Icon
                    accessible={false}
                    name="magnifying-glass"
                    size={17}
                    color={colors.textSecondary}
                />
                <ThemeText
                    accessible={false}
                    fontColor="textSecondary"
                    style={styles.text}>
                    {t("home.clickToSearch")}
                </ThemeText>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    appbar: {
        flexDirection: "row",
        alignItems: "center",
        width: "100%",
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    searchBar: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        height: 36,
        borderRadius: 10,
        paddingHorizontal: 10,
    },
    text: {
        marginLeft: 6,
    },
});
