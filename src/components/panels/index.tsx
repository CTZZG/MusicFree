import React from "react";
import { FontScaleScope } from "@/components/base/fontScaleScope";
import { fontScaleMigratedPanels } from "@/constants/fontScaleMigration";
import panels from "./types";
import { panelInfoStore } from "./usePanel";

function Panels() {
    const panelInfoState = panelInfoStore.useValue();

    const Component = panelInfoState.name ? panels[panelInfoState.name] : null;

    return Component ? (
        // 已核对过系统字体放大的面板，ThemeText 跟随系统字体
        <FontScaleScope
            followSystem={fontScaleMigratedPanels.has(panelInfoState.name!)}>
            <Component
                key={panelInfoState.seq}
                {...(panelInfoState.payload ?? {})}
            />
        </FontScaleScope>
    ) : null;
}

export default React.memo(Panels, () => true);