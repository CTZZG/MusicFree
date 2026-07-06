import React from "react";
import globalStyle from "@/constants/globalStyle";
import { useAppConfig } from "@/core/appConfig";
import HomeOverview from "../homeBody/homeOverview";
import Operations from "./operations";
import { View } from "react-native";
import Sheets from "../homeBody/sheets";

function LegacyHomeBodyHorizontal() {
    return (
        <View style={globalStyle.rowfwflex1}>
            <Operations />
            <View style={globalStyle.fwflex1}>
                <Sheets />
            </View>
        </View>
    );
}

export default function HomeBodyHorizontal() {
    const useEnhancedHome = useAppConfig("theme.useEnhancedHome") ?? true;

    return useEnhancedHome ? <HomeOverview /> : <LegacyHomeBodyHorizontal />;
}
