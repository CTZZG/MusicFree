import { useAppConfig } from "@/core/appConfig";
import rpx from "@/utils/rpx";
import React from "react";
import { StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import ClassicContinueHero from "./classicContinueHero";
import ClassicRecentListening from "./classicRecentListening";
import Operations from "./operations";
import Sheets from "./sheets";
import useHomeOverview from "./useHomeOverview";

export default function ClassicHomeBody() {
    const data = useHomeOverview();
    const hideHomeHeroCard = useAppConfig("theme.hideHomeHeroCard") ?? false;
    const hideHomeRecentListening =
        useAppConfig("theme.hideHomeRecentListening") ?? false;
    const hideHomeOperations = useAppConfig("theme.hideHomeOperations") ?? false;

    return (
        <ScrollView
            style={styles.wrapper}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}>
            {!hideHomeHeroCard ? (
                <ClassicContinueHero
                    currentMusic={data.currentMusic}
                    featuredMusic={data.featuredMusic}
                />
            ) : null}
            {!hideHomeOperations ? <Operations /> : null}
            {!hideHomeRecentListening ? (
                <ClassicRecentListening musics={data.recentMusics} />
            ) : null}
            <Sheets variant="classic" />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    contentContainer: {
        paddingBottom: rpx(36),
    },
});
