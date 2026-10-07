import React from "react";

import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PluginList from "./views/pluginList";
import PluginSort from "./views/pluginSort";
import PluginSubscribe from "./views/pluginSubscribe";
import { useParams } from "@/core/router";
import LxSourceList from "./views/lxSourceList";
import useColors from "@/hooks/useColors";

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
        path: "/pluginsetting/lx-source",
        component: LxSourceList,
    },
];

export default function PluginSetting() {
    const params = useParams<"setting">();
    const colors = useColors();
    const requestedInitialRouteName = params?.initialPluginSettingRoute;
    const initialRouteName = requestedInitialRouteName &&
        routes.some(route => route.path === requestedInitialRouteName)
        ? requestedInitialRouteName
        : routes[0].path;
    const navigatorKey = `${initialRouteName}:${params?.initialPluginName ?? ""}`;

    return (
        <Stack.Navigator
            key={navigatorKey}
            initialRouteName={initialRouteName}
            screenOptions={{
                headerShown: false,
                animation: "slide_from_right",
                animationDuration: 100,
                // The navigation theme is transparent. Each child scene must
                // cover the next scene until the native slide reveals it.
                contentStyle: { backgroundColor: colors.background },
            }}>
            {routes.map(route => {
                const RouteComponent = route.component;
                return (
                    <Stack.Screen
                        key={route.path}
                        name={route.path}
                        initialParams={{
                            initialPluginName: params?.initialPluginName,
                        }}>
                        {() => <RouteComponent />}
                    </Stack.Screen>
                );
            })}
        </Stack.Navigator>
    );
}
