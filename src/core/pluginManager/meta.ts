import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { errorLog } from "@/utils/log";
import { getStorage, removeStorage } from "@/utils/storage";
import type { IPluginCapability } from "@/types/core/pluginManager";

type IPluginPlatform = string;

interface IPluginMetaStorage {
    $version: number;
    order: Record<IPluginPlatform, number>;
    disabledPlugins: Array<IPluginPlatform>;
    [key: `${IPluginPlatform}.alternativePlugin`]: IPluginPlatform | null;
    [key: `${IPluginPlatform}.userVariables`]: Record<string, string>;
    [key: `${IPluginPlatform}.capabilities`]: IPluginCapability[];
    [key: `${IPluginPlatform}.capabilityPolicyVersion`]: number;

}


const storage = getOrCreateMMKV("plugin-meta");

class PluginMeta {
    private cachedDisabledPlugins: Set<IPluginPlatform> | null = null;

    private getMetaStorage<K extends keyof IPluginMetaStorage>(key: K): IPluginMetaStorage[K] | null {
        return safeParse(storage.getString(key));
    }

    private setMetaStorage<K extends keyof IPluginMetaStorage>(key: K, value: IPluginMetaStorage[K]) {
        const storageValue = safeStringify(value);
        storage.set(key, storageValue);
    }

    async migratePluginMeta() {
        const metaVersion = storage.getNumber("$version") ?? -1;
        if (metaVersion < 0) {
            // 从async storage迁移到mmkv

            try {
                const rawMeta = await getStorage("plugin-meta");
                const order: Record<IPluginPlatform, number> = {};
                const disabledPlugins = new Set<IPluginPlatform>();

                if (rawMeta !== null) {
                    for (let platformName in rawMeta) {
                        const metaVal = rawMeta[platformName];
                        if (!metaVal) {
                            continue;
                        }
                        if (metaVal?.order !== undefined && metaVal.order !== null) {
                            order[platformName] = metaVal.order;
                        }
                        if (metaVal?.enabled !== undefined && metaVal.enabled === false) {
                            disabledPlugins.add(platformName);
                        }
                        if (metaVal?.userVariables !== undefined && metaVal.userVariables !== null) {
                            storage.set(platformName + ".userVariables", safeStringify(metaVal.userVariables));
                        }
                    }
                }
                // 将 order 和 disabledPlugins 存储到 mmkv
                storage.set("order", safeStringify(order));
                storage.set("disabledPlugins", safeStringify(Array.from(disabledPlugins)));

                // 移除
                await removeStorage("plugin-meta");
            } catch (e) {
                errorLog("迁移 plugin meta 失败", e);
            }


            storage.set("$version", 1);
        }
    }

    getPluginOrder() {
        return this.getMetaStorage("order") ?? {};
    }

    setPluginOrder(orderMap: Record<IPluginPlatform, number>) {
        this.setMetaStorage("order", orderMap);
    }


    public get disabledPlugins() {
        if (this.cachedDisabledPlugins) {
            return this.cachedDisabledPlugins;
        }
        const disabledPlugins = this.getMetaStorage("disabledPlugins") ?? [];
        this.cachedDisabledPlugins = new Set(disabledPlugins);
        return this.cachedDisabledPlugins;
    }

    isPluginEnabled(pluginPlatform: IPluginPlatform) {
        const disabledPluginsSet = this.disabledPlugins;
        return !disabledPluginsSet.has(pluginPlatform);
    }


    setPluginEnabled(pluginPlatform: IPluginPlatform, enabled: boolean) {
        const disabledPluginsSet = this.disabledPlugins;

        if (enabled) {
            disabledPluginsSet.delete(pluginPlatform);
        } else {
            disabledPluginsSet.add(pluginPlatform);
        }
        this.setMetaStorage("disabledPlugins", Array.from(disabledPluginsSet));
        this.cachedDisabledPlugins = disabledPluginsSet;
    }

    getUserVariables(pluginPlatform: IPluginPlatform) {
        const userVariables = this.getMetaStorage(`${pluginPlatform}.userVariables`) ?? {};
        return userVariables;
    }

    setUserVariables(pluginPlatform: IPluginPlatform, userVariables: Record<string, string>) {
        this.setMetaStorage(`${pluginPlatform}.userVariables`, userVariables);
    }

    setAlternativePlugin(
        pluginPlatform: IPluginPlatform,
        alternativePluginPlatform: IPluginPlatform | null,
    ) {
        this.setMetaStorage(`${pluginPlatform}.alternativePlugin`, alternativePluginPlatform);
    }

    getAlternativePlugin(pluginPlatform: IPluginPlatform): IPluginPlatform | null {
        const alternativePlugin = this.getMetaStorage(`${pluginPlatform}.alternativePlugin`);
        if (alternativePlugin) {
            return alternativePlugin;
        }
        return null;
    }

    getApprovedCapabilities(pluginPlatform: IPluginPlatform) {
        return this.getMetaStorage(`${pluginPlatform}.capabilities`) ?? [];
    }

    hasCapabilityDecision(pluginPlatform: IPluginPlatform) {
        return storage.getNumber(
            `${pluginPlatform}.capabilityPolicyVersion`,
        ) === 1;
    }

    setApprovedCapabilities(
        pluginPlatform: IPluginPlatform,
        capabilities: IPluginCapability[],
    ) {
        this.setMetaStorage(
            `${pluginPlatform}.capabilities`,
            [...new Set(capabilities)].sort(),
        );
        storage.set(`${pluginPlatform}.capabilityPolicyVersion`, 1);
    }

    clearApprovedCapabilities(pluginPlatform: IPluginPlatform) {
        storage.delete(`${pluginPlatform}.capabilities`);
        storage.delete(`${pluginPlatform}.capabilityPolicyVersion`);
    }
}


const _internalPluginMeta = new PluginMeta();
 
export default _internalPluginMeta;
