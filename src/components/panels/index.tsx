import React from "react";
import panels from "./types";
import { panelInfoStore } from "./usePanel";

function Panels() {
    const panelInfoState = panelInfoStore.useValue();

    const Component = panelInfoState.name ? panels[panelInfoState.name] : null;

    return Component ? (
        <Component
            key={panelInfoState.seq}
            {...(panelInfoState.payload ?? {})}
        />
    ) : null;
}

export default React.memo(Panels, () => true);