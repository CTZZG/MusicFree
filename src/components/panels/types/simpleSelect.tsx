import React, { Fragment } from "react";
import { ScrollView, StyleSheet } from "react-native";
import rpx, { vh } from "@/utils/rpx";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PanelBase from "../base/panelBase";
import { hidePanel } from "../usePanel";
import ListItem from "@/components/base/listItem";
import PanelHeader from "../base/panelHeader";
import { IIconName } from "@/components/base/icon";

interface ICandidateItem {
    title?: string;
    icon?: IIconName;
    value: any;
}

interface ISimpleSelectProps {
    height?: number;
    header?: string;
    candidates?: Array<ICandidateItem>;
    onPress?: (item: ICandidateItem) => void;
}

const HEADER_HEIGHT = rpx(100);
const ITEM_HEIGHT = rpx(96);
const MIN_PANEL_HEIGHT = rpx(320);
const MAX_PANEL_HEIGHT = vh(82);
const MIN_BOTTOM_PADDING = rpx(24);

export default function SimpleSelect(props: ISimpleSelectProps) {
    const {
        height,
        header = "",
        candidates = [],
        onPress,
    } = props ?? {};

    const safeAreaInsets = useSafeAreaInsets();
    const bottomPadding = Math.max(safeAreaInsets.bottom, MIN_BOTTOM_PADDING);
    const contentHeight = HEADER_HEIGHT + candidates.length * ITEM_HEIGHT + bottomPadding;
    const panelHeight = height ?? Math.min(
        Math.max(contentHeight, MIN_PANEL_HEIGHT),
        MAX_PANEL_HEIGHT,
    );

    return (
        <PanelBase
            height={panelHeight}
            renderBody={() => (
                <>
                    <PanelHeader title={header} hideButtons />

                    <ScrollView
                        style={styles.body}
                        contentContainerStyle={{ paddingBottom: bottomPadding }}>
                        {candidates.map((it, index) => {
                            return (
                                <Fragment key={`frag-${index}`}>
                                    <ListItem
                                        heightType="small"
                                        withHorizontalPadding
                                        onPress={() => {
                                            onPress?.(it);
                                            hidePanel();
                                        }}>
                                        {
                                            it.icon ? <ListItem.ListItemIcon icon={it.icon} /> : null
                                        }
                                        <ListItem.Content
                                            title={it.title ?? it.value}
                                        />
                                    </ListItem>
                                </Fragment>
                            );
                        })}
                    </ScrollView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    header: {
        width: "100%",
        flexDirection: "row",
        padding: rpx(24),
    },
    body: {
        flex: 1,
    },
    item: {
        height: rpx(96),
        justifyContent: "center",
    },
});
