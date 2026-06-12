import React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import Empty from "@/components/base/empty";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import DislikeMusic, {
    IDislikeRule,
    useDislikeRules,
} from "@/core/dislikeMusic";
import { useI18N } from "@/core/i18n";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

function getRuleTitle(rule: IDislikeRule) {
    if (rule.type === "music") {
        return rule.title || rule.musicId || "-";
    }
    if (rule.type === "artist-title") {
        return `${rule.artist || "-"} - ${rule.title || "-"}`;
    }
    return rule.artist || "-";
}

export default function DislikeMusicSetting() {
    const rules = useDislikeRules();
    const { t } = useI18N();

    function getRuleDescription(rule: IDislikeRule) {
        return t(`dislikeMusic.ruleType.${rule.type}` as any);
    }

    return (
        <FlatList
            data={rules}
            ListEmptyComponent={<Empty content={t("dislikeMusic.empty")} />}
            ListFooterComponent={<View style={style.footer} />}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
                <ListItem withHorizontalPadding heightType="normal">
                    <ListItem.Content
                        title={getRuleTitle(item)}
                        description={getRuleDescription(item)}
                    />
                    <ThemeText
                        fontSize="description"
                        fontColor="primary"
                        style={style.action}
                        onPress={() => {
                            DislikeMusic.removeRule(item.id);
                            Toast.success(t("toast.deleteSuccess"));
                        }}>
                        {t("common.delete")}
                    </ThemeText>
                </ListItem>
            )}
        />
    );
}

const style = StyleSheet.create({
    footer: {
        height: rpx(160),
    },
    action: {
        paddingHorizontal: rpx(16),
    },
});
