import { useParams } from "@/core/router";
import { getDefaultStore, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import {
    editingMusicListAtom,
    editingMusicListBaselineAtom,
    musicListChangedAtom,
} from "../store/atom";
import { showDialog } from "@/components/dialogs/useDialog";
import i18n from "@/core/i18n";
import { useNavigation } from "@react-navigation/native";
import Toast from "@/utils/toast";
import { saveEditingMusicList } from "../store/action";

export default function Business() {
    const { musicSheet, musicList } = useParams<"music-list-editor">();
    const doubleConfirmRef = useRef(false);
    const navigation = useNavigation();

    const setEditingMusicList = useSetAtom(editingMusicListAtom);
    const setEditingMusicListBaseline = useSetAtom(
        editingMusicListBaselineAtom,
    );
    const setMusicListChanged = useSetAtom(musicListChangedAtom);

    useEffect(() => {
        const initialMusicList = musicList ?? [];
        setEditingMusicListBaseline(initialMusicList);
        setEditingMusicList(
            initialMusicList.map(_ => ({ musicItem: _, checked: false })),
        );

        const navigationBackHandler = e => {
            if (
                e.data.action.type === "GO_BACK" &&
                !doubleConfirmRef.current &&
                getDefaultStore().get(musicListChangedAtom)
            ) {
                e.preventDefault();
                showDialog("SimpleDialog", {
                    title: i18n.t("dialog.simpleDialog.hasUnsavedChange.title"),
                    content: i18n.t(
                        "dialog.simpleDialog.hasUnsavedChange.content",
                    ),
                    okText: i18n.t("common.save"),
                    cancelText: i18n.t("common.notSave"),
                    async onOk() {
                        if (musicSheet?.id) {
                            try {
                                await saveEditingMusicList(musicSheet.id);
                                Toast.success(i18n.t("toast.saveSuccess"));
                            } catch (error) {
                                Toast.warn(
                                    `${i18n.t("common.error")}: ${
                                        error instanceof Error
                                            ? error.message
                                            : String(error)
                                    }`,
                                );
                                return;
                            }
                        }
                        doubleConfirmRef.current = true;
                        navigation.goBack();
                    },
                    onCancel() {
                        doubleConfirmRef.current = true;
                        navigation.goBack();
                    },
                    onDismiss() {
                        doubleConfirmRef.current = false;
                    },
                });
            }
        };
        navigation.addListener("beforeRemove", navigationBackHandler);

        return () => {
            setEditingMusicList([]);
            setEditingMusicListBaseline([]);
            setMusicListChanged(false);
            navigation.removeListener("beforeRemove", navigationBackHandler);
        };
    }, []);

    return null;
}
