import React, { memo, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import MusicItem from "@/components/mediaItem/musicItem";
import { produce } from "immer";
import { useAtom, useSetAtom } from "jotai";
import {
    IEditorMusicItem,
    editingMusicListAtom,
    musicListChangedAtom,
} from "../store/atom";

import CheckBox from "@/components/base/checkbox";
import useColors from "@/hooks/useColors";
import Empty from "@/components/base/empty";
import SortableFlashList from "@/components/base/sortableFlashList";

interface IMusicEditorItemProps {
    index: number;
    editorMusicItem: IEditorMusicItem;
}
function MusicEditorItemView(props: IMusicEditorItemProps) {
    const { index, editorMusicItem } = props;
    const setEditingMusicList = useSetAtom(editingMusicListAtom);

    const onPress = useCallback(() => {
        setEditingMusicList(
            produce(draft => {
                draft[index].checked = !draft[index].checked;
            }),
        );
    }, [index, setEditingMusicList]);

    return (
        <MusicItem
            musicItem={editorMusicItem.musicItem}
            left={() => (
                <View style={style.checkBox}>
                    <CheckBox checked={editorMusicItem.checked} />
                </View>
            )}
            showMoreIcon={false}
            itemPaddingRight={rpx(100)}
            onItemPress={onPress}
        />
    );
}

const MusicEditorItem = memo(
    MusicEditorItemView,
    (prev, curr) =>
        prev.editorMusicItem === curr.editorMusicItem &&
        prev.index === curr.index,
);

/** 音乐列表 */
export default function MusicList() {
    const [editingMusicList, setEditingMusicList] =
        useAtom(editingMusicListAtom);
    const setMusicListChanged = useSetAtom(musicListChangedAtom);

    const renderItem = useCallback(
        ({ index, item }: any) => {
            return <MusicEditorItem editorMusicItem={item} index={index!} />;
        },
        [],
    );
    const keyExtractor = useCallback(
        (item: IEditorMusicItem) => `${item.musicItem.platform}-${item.musicItem.id}`,
        [],
    );
    const onSortEnd = useCallback((newData: IEditorMusicItem[]) => {
        setEditingMusicList(newData);
        setMusicListChanged(true);
    }, [setEditingMusicList, setMusicListChanged]);
    const colors = useColors();

    return editingMusicList?.length ? (
        <SortableFlashList 
            activeBackgroundColor={colors.placeholder}
            data={editingMusicList} 
            keyExtractor={keyExtractor}
            renderItem={renderItem} 
            onSortEnd={onSortEnd}
        />
    ) : (
        <Empty />
    );
}

const style = StyleSheet.create({
    checkBox: {
        height: "100%",
        justifyContent: "center",
        marginRight: rpx(16),
    },
});
