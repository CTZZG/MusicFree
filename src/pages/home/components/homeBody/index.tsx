import React from "react";
import { useAppConfig } from "@/core/appConfig";
import ClassicHomeBody from "./classicHome";
import HomeOverview from "./homeOverview";

export default function HomeBody() {
    const useEnhancedHome = useAppConfig("theme.useEnhancedHome") ?? true;

    return useEnhancedHome ? <HomeOverview /> : <ClassicHomeBody />;
}
