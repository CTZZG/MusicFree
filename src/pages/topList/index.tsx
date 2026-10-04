import React from "react";
import { View } from "react-native";
import TopListBody from "./components/topListBody";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";

export default function TopList() {
    const { t } = useI18N();

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <AppBar withStatusBar>{t("topList.title")}</AppBar>
            <View style={globalStyle.flex1}>
                <TopListBody />
            </View>
        </VerticalSafeAreaView>
    );
}
