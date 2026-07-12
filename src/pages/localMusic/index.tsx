import React from "react";
import MainPage from "./mainPage";
import { ShortcutPageSurface } from "@/components/base/shortcutPageSurface";

export default function LocalMusic() {
    return (
        <ShortcutPageSurface>
            <MainPage />
        </ShortcutPageSurface>
    );
}
