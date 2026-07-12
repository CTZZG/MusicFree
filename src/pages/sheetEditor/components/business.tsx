import { getDefaultStore, useSetAtom } from "jotai";
import {
    editingMusicSheetAtom,
    loadedSheetTypeAtom,
    musicSheetChangedAtom,
    sheetTypeAtom,
} from "../store/atom";
import { useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import { useParams } from "@/core/router";
import { beginSheetTypeChange } from "../store/action";
import { confirmSheetEditorTransition } from "../store/transition";

export default function Business() {
    const { sheetType } = useParams<"sheet-editor">();
    const setEditingMusicSheetAtom = useSetAtom(editingMusicSheetAtom);
    const setLoadedSheetType = useSetAtom(loadedSheetTypeAtom);
    const setMusicSheetChangedAtom = useSetAtom(musicSheetChangedAtom);
    const navigation = useNavigation();
    const doubleConfirmRef = useRef(false);

    useEffect(() => {
        const store = getDefaultStore();
        if (
            store.get(sheetTypeAtom) !== sheetType ||
            store.get(loadedSheetTypeAtom) !== sheetType
        ) {
            beginSheetTypeChange(sheetType);
        }
    }, [sheetType]);

    useEffect(() => {
        const navigationBackHandler = (e) => {
            if (e.data.action.type === "GO_BACK" && !doubleConfirmRef.current && getDefaultStore().get(musicSheetChangedAtom)) {
                e.preventDefault();
                confirmSheetEditorTransition(() => {
                    doubleConfirmRef.current = true;
                    navigation.dispatch(e.data.action);
                });
            }
        };
        navigation.addListener("beforeRemove", navigationBackHandler);

        return () => {
            setEditingMusicSheetAtom([]);
            setLoadedSheetType(null);
            setMusicSheetChangedAtom(false);
            navigation.removeListener("beforeRemove", navigationBackHandler);
        };
    }, [
        navigation,
        setEditingMusicSheetAtom,
        setLoadedSheetType,
        setMusicSheetChangedAtom,
    ]);

    return null;
}
