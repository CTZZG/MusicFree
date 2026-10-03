import React from "react";
import { StyleSheet } from "react-native";
import Mode from "./mode";
import Background from "./background";
import CoverStyle from "./coverStyle";
import HomeDisplay from "./homeDisplay";
import { ScrollView } from "react-native-gesture-handler";

export default function ThemeSetting() {
    return (
        <ScrollView
            style={style.wrapper}
            contentContainerStyle={style.content}>
            <Mode />
            <Background />
            <HomeDisplay />
            <CoverStyle />
        </ScrollView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
    },
    content: {
        paddingBottom: 32,
    },
});
