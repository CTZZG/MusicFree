import AppBar from "@/components/base/appBar";
import i18n, { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";
import { useAtomValue } from "jotai";
import { musicListChangedAtom } from "../store/atom";
import { saveEditingMusicList } from "../store/action";
import Toast from "@/utils/toast";

export default function NavBar() {
    const { musicSheet } = useParams<"music-list-editor">();
    const { t } = useI18N();

    const isDirty = useAtomValue(musicListChangedAtom);

    return (
        <AppBar
            actions={[
                {
                    icon: "save-outline",
                    accessibilityLabel: t("common.save"),
                    disabled: !isDirty,
                    onPress: async () => {
                        if (isDirty && musicSheet?.id) {
                            try {
                                await saveEditingMusicList(musicSheet.id);
                                Toast.success(t("toast.saveSuccess"));
                            } catch (error) {
                                Toast.warn(
                                    `${t("common.error")}: ${
                                        error instanceof Error
                                            ? error.message
                                            : String(error)
                                    }`,
                                );
                            }
                        }
                    },
                },
            ]}>
            {musicSheet?.title ?? i18n.t("common.sheet")}
        </AppBar>
    );
}
