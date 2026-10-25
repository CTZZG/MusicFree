import React from "react";
import HomeSectionEditor from "@/pages/home/components/homeBody/homeSectionEditor";
import { useI18N } from "@/core/i18n";
import { vh } from "@/utils/rpx";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { ScrollView, StyleSheet } from "react-native";

export default function HomeSections() {
    const { t } = useI18N();
    return (
        <PanelBase
            height={vh(65)}
            renderBody={() => (
                <>
                    <PanelHeader title={t("homeOrder.title")} hideButtons allowTitleWrap />
                    <ScrollView style={styles.scroll}>
                        <HomeSectionEditor />
                    </ScrollView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({ scroll: { flex: 1 } });
