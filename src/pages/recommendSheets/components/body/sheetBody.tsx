import React, { memo, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import globalStyle from "@/constants/globalStyle";
import { ScrollView } from "react-native-gesture-handler";
import TypeTag from "../../../../components/base/typeTag";

import useRecommendList from "../../hooks/useRecommendListTags";
import SheetList from "./sheetList";
import { hidePanel, showPanel } from "@/components/panels/usePanel";
import { useI18N } from "@/core/i18n";

interface IProps {
    hash: string;
}


function SheetBody(props: IProps) {
    const { hash } = props;

    const { t } = useI18N();

    const defaultTag: ICommon.IUnique = useMemo(() => ({
        title: t("common.default"),
        id: "",
    }), [t]);

    // 选中的tag
    const [selectedTag, setSelectedTag] = useState<ICommon.IUnique>(defaultTag);

    // 第一个tag
    const [firstTag, setFirstTag] = useState<ICommon.IUnique>(defaultTag);

    // 所有tag
    const tags = useRecommendList(hash);

    return (
        <View style={globalStyle.fwflex1}>
            <ScrollView
                style={style.headerWrapper}
                contentContainerStyle={style.header}
                showsHorizontalScrollIndicator={false}
                horizontal>
                <TypeTag
                    title={firstTag.title}
                    selected={selectedTag.id === firstTag.id}
                    onPress={() => {
                        // 拉起浮层
                        showPanel("SheetTags", {
                            tags: tags?.data ?? [],
                            onTagPressed(tag) {
                                setSelectedTag(tag);
                                setFirstTag(tag);
                                hidePanel();
                            },
                        });
                    }}
                />
                {(tags?.pinned ?? []).map(_ => (
                    <TypeTag
                        key={`pinned-${_.id}`}
                        title={_?.title ?? ""}
                        selected={selectedTag.id === _.id}
                        onPress={() => {
                            setSelectedTag(_);
                        }}
                    />
                ))}
            </ScrollView>
            <SheetList tag={selectedTag} pluginHash={hash} />
        </View>
    );
}

export default memo(SheetBody, (prev, curr) => prev.hash === curr.hash);

const style = StyleSheet.create({
    headerWrapper: {
        flexGrow: 0,
        // ScrollView 默认可以收缩：下面的歌单列表一长（横屏时尤其明显），标签条就被
        // 压得比标签还矮，标签上下被裁掉
        flexShrink: 0,
    },
    header: {
        // 按标签定高：字体放大、标签变高时标签条跟着变高
        minHeight: rpx(100),
        paddingVertical: rpx(12),
        alignItems: "center",
        // 标签自带左右 rpx(16) 的外边距，补到 16，第一个标签与下面的歌单网格左对齐
        paddingHorizontal: 16 - rpx(16),
    },
});
