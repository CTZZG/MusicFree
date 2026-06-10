import React from "react";

import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PluginList from "./views/pluginList";
import PluginSort from "./views/pluginSort";
import PluginSubscribe from "./views/pluginSubscribe";
import PluginDiagnostics from "./views/pluginDiagnostics";
import { useParams } from "@/core/router";

const Stack = createNativeStackNavigator<any>();

const routes = [
    {
        path: "/pluginsetting/list",
        component: PluginList,
    },
    {
        path: "/pluginsetting/sort",
        component: PluginSort,
    },
    {
        path: "/pluginsetting/subscribe",
        component: PluginSubscribe,
    },
    {
        path: "/pluginsetting/diagnostics",
        component: PluginDiagnostics,
    },
];

export default function PluginSetting() {
    const params = useParams<"setting">();

    return (
        <Stack.Navigator
            initialRouteName={routes[0].path}
            screenOptions={{
                headerShown: false,
                animation: "slide_from_right",
                animationDuration: 100,
            }}>
            {routes.map(route => (
                <Stack.Screen
                    key={route.path}
                    name={route.path}
                    component={route.component}
                    initialParams={{
                        initialPluginName: params?.initialPluginName,
                    }}
                />
            ))}
        </Stack.Navigator>
    );
}
