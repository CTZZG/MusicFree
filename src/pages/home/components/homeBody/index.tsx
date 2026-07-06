import React from "react";
import globalStyle from "@/constants/globalStyle";
import { useAppConfig } from "@/core/appConfig";
import { ScrollView } from "react-native-gesture-handler";
import HomeOverview from "./homeOverview";
import Operations from "./operations";
import Sheets from "./sheets";

function LegacyHomeBody() {
    return (
        <ScrollView
            style={globalStyle.fwflex1}
            showsVerticalScrollIndicator={false}>
            <Operations />
            <Sheets />
        </ScrollView>
    );
}

export default function HomeBody() {
    const useEnhancedHome = useAppConfig("theme.useEnhancedHome") ?? true;

    return useEnhancedHome ? <HomeOverview /> : <LegacyHomeBody />;
}
