import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";
import React from "react";
import Body from "./components/body";
import {
    ShortcutPageSurface,
    ShortcutStatusBar,
} from "@/components/base/shortcutPageSurface";

export default function RecommendSheets() {
    const { t } = useI18N();

    return (
        <ShortcutPageSurface>
            <ShortcutStatusBar />
            <AppBar backgroundColor="transparent" spacious>{t("recommendSheet.title")}</AppBar>
            <Body />
        </ShortcutPageSurface>
    );
}
