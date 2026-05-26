import React from "react";
import AppBar from "@/components/base/appBar";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import MusicBar from "@/components/musicBar";
import globalStyle from "@/constants/globalStyle";
import { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";
import Sheets from "@/pages/home/components/homeBody/sheets";

export default function SheetBrowser() {
    const { t } = useI18N();
    const params = useParams<"sheet-browser">();

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <AppBar withStatusBar>{t("common.sheet")}</AppBar>
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                <Sheets initialSheetType={params?.sheetType} />
            </HorizontalSafeAreaView>
            <MusicBar />
        </VerticalSafeAreaView>
    );
}
