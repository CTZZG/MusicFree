import React from "react";
import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";

/** 播放页封面形状：方形或圆形 */
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
        </GroupedSection>
    );
}
