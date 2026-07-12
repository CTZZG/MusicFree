import React from "react";
import NavBar from "./components/navBar";
import Bottom from "./components/bottom";
import SheetList from "./components/sheetList";
import Business from "./components/business";
import {
    ShortcutPageSurface,
    ShortcutStatusBar,
} from "@/components/base/shortcutPageSurface";

export default function SheetEditor() {

    return (
        <ShortcutPageSurface>
            <Business />
            <ShortcutStatusBar />
            <NavBar />
            <SheetList />
            <Bottom />
        </ShortcutPageSurface>
    );
}
