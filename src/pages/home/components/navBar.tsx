import { useNavigation } from "@react-navigation/native";
import React from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import ThemeText from "@/components/base/themeText";
import IconButton from "@/components/base/iconButton";
import { useI18N } from "@/core/i18n";

export default function NavBar() {
    const navigation = useNavigation<any>();
    const colors = useColors();
    const { t } = useI18N();

    return (
        <View style={styles.appbar}>
            <IconButton
                accessibilityLabel={t("home.openSidebar.a11y")}
                name="bars-3"
                style={styles.menu}
                color={colors.text}
                onPress={() => {
                    navigation?.openDrawer();
                }}
            />

            <View style={styles.titleBar}>
                <ThemeText
                    fontSize="appbar"
                    fontWeight="bold"
                    numberOfLines={1}>
                    MusicFree
                </ThemeText>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    appbar: {
        backgroundColor: "transparent",
        shadowColor: "transparent",
        flexDirection: "row",
        alignItems: "center",
        width: "100%",
        height: rpx(88),
    },
    titleBar: {
        marginHorizontal: rpx(24),
        flex: 1,
        height: "72%",
        maxHeight: rpx(64),
        justifyContent: "center",
    },
    menu: {
        marginLeft: rpx(24),
    },
});
