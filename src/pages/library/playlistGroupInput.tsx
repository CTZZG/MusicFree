import React, { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";

export default function PlaylistGroupInput(props: { onChange: (value: string) => void }) {
    const [name, setName] = useState("");
    const { t } = useI18N();
    const colors = useColors();
    return (
        <TextInput
            testID="library-group-name"
            accessibilityLabel={t("library.groupName")}
            placeholder={t("library.groupName")}
            placeholderTextColor={colors.textSecondary}
            maxLength={40}
            autoFocus
            value={name}
            onChangeText={value => {
                setName(value);
                props.onChange(value);
            }}
            style={[styles.input, { color: colors.text, backgroundColor: colors.placeholder }]}
        />
    );
}

const styles = StyleSheet.create({
    input: {
        minHeight: 48,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        fontSize: 16,
    },
});
