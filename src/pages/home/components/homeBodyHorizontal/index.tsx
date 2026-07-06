import React from "react";
import { useAppConfig } from "@/core/appConfig";
import ClassicHomeBody from "../homeBody/classicHome";
import HomeOverview from "../homeBody/homeOverview";

export default function HomeBodyHorizontal() {
    const useEnhancedHome = useAppConfig("theme.useEnhancedHome") ?? true;

    return useEnhancedHome ? <HomeOverview /> : <ClassicHomeBody />;
}
