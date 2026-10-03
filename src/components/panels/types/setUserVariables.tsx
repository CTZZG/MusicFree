import React, { useRef } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { vmax } from "@/utils/rpx";
import useColors from "@/hooks/useColors";

import ThemeText from "@/components/base/themeText";
import { ScrollView } from "react-native-gesture-handler";
import PanelBase from "../base/panelBase";
import { hidePanel } from "../usePanel";
import Input from "@/components/base/input";
import globalStyle from "@/constants/globalStyle";
import { useI18N } from "@/core/i18n";
import PanelHeader from "../base/panelHeader";

interface IUserVariablesProps {
    title?: string;
    onOk: (values: Record<string, string>, closePanel: () => void) => void;
    variables: Array<IPlugin.IUserVariable & {
        secureTextEntry?: boolean;
    }>;
    initValues?: Record<string, string>;
    onCancel?: () => void;
}

/**
 * 插件用户变量、Last.fm 凭据、WebDAV 设置共用的表单。
 *
 * 每一项是 iOS 表单的写法：名称在上、输入框占满一行、说明完整写在下面。
 * 以前名称和输入框挤在一行，名称最多占 35%、说明只放在占位文字里，两者都被
 * 截断，而且一开始输入说明就看不见了（「留空则保留已保存的密码」这类说明尤其
 * 要紧）。
 */
export default function SetUserVariables(props: IUserVariablesProps) {
    const { onOk, onCancel, variables, initValues = {}, title } = props;

    const colors = useColors();
    const { t } = useI18N();

    const resultRef = useRef({ ...initValues });

    return (
        <PanelBase
            height={vmax(80)}
            positionMethod="top"
            keyboardAvoidBehavior="none"
            renderBody={() => (
                <>
                    <PanelHeader
                        title={title ?? t("panel.setUserVariables.title")}
                        onCancel={() => {
                            onCancel?.();
                            hidePanel();
                        }}
                        onOk={async () => {
                            onOk(resultRef.current, hidePanel);
                        }}
                    />
                    <KeyboardAvoidingView
                        behavior="padding"
                        style={globalStyle.flex1}>
                        <ScrollView
                            keyboardShouldPersistTaps="handled"
                            contentContainerStyle={styles.content}>
                            {variables.map(it => (
                                <View key={it.key} style={styles.field}>
                                    <ThemeText
                                        fontWeight="semibold"
                                        style={styles.label}>
                                        {it.name ?? it.key}
                                    </ThemeText>
                                    <Input
                                        secureTextEntry={it.secureTextEntry}
                                        defaultValue={initValues[it.key]}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        accessibilityLabel={it.name ?? it.key}
                                        accessibilityHint={it.hint}
                                        onChangeText={e => {
                                            resultRef.current[it.key] = e;
                                        }}
                                        style={[
                                            styles.input,
                                            {
                                                backgroundColor:
                                                    colors.placeholder,
                                            },
                                        ]}
                                    />
                                    {it.hint ? (
                                        <ThemeText
                                            fontSize="description"
                                            fontColor="textSecondary"
                                            style={styles.hint}>
                                            {it.hint}
                                        </ThemeText>
                                    ) : null}
                                </View>
                            ))}
                        </ScrollView>
                    </KeyboardAvoidingView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: vmax(20),
    },
    field: {
        marginBottom: 22,
    },
    label: {
        marginBottom: 8,
    },
    input: {
        width: "100%",
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
    },
    hint: {
        marginTop: 6,
        lineHeight: 18,
    },
});
