import React from "react";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";

/** 播放页封面样式：圆角卡片、旋转唱片或铺满顶部的大图 */
export default function CoverStyle() {
    const { t } = useI18N();
    const coverStyle = useAppConfig("theme.coverStyle") ?? "square";

    return (
        <GroupedSection title={t("themeSettings.coverStyle")}>
            <GroupedRow
                title={t("themeSettings.coverStyleSquare")}
                accessory={coverStyle === "square" ? "check" : "none"}
                onPress={() => {
                    Config.setConfig("theme.coverStyle", "square");
                }}
            />
            <GroupedRow
                title={t("themeSettings.coverStyleCircle")}
                accessory={coverStyle === "circle" ? "check" : "none"}
                onPress={() => {
                    Config.setConfig("theme.coverStyle", "circle");
                }}
            />
            <GroupedRow
                title={t("themeSettings.coverStyleHero")}
                accessory={coverStyle === "hero" ? "check" : "none"}
                onPress={() => {
                    Config.setConfig("theme.coverStyle", "hero");
                }}
            />
        </GroupedSection>
    );
}
