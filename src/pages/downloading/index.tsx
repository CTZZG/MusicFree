import React from "react";
import DownloadingList from "./downloadingList";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";
import {
    ShortcutPageSurface,
    ShortcutStatusBar,
} from "@/components/base/shortcutPageSurface";

export default function Downloading() {
    const { t } = useI18N();

    return (
        <ShortcutPageSurface>
            <ShortcutStatusBar />
            <AppBar backgroundColor="transparent" spacious>{t("downloading.title")}</AppBar>
            <DownloadingList />
        </ShortcutPageSurface>
    );
}
