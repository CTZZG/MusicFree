import type panels from "@/components/panels/types";
import type { HomeTabName } from "@/core/router";
import type { RoutePaths } from "@/core/router/routes";

/**
 * 已经核对过系统字体放大、ThemeText 跟随系统字体的页面（路由名）和面板。
 *
 * 迁移一个页面或面板：
 * 1. 在布局测试（tests/layout）里按 1、1.3、1.5、2 倍检查，渲染时包上与 App
 *    相同的 FontScaleScope（读这份名单）；
 * 2. 先处理固定高度的容器（height 改 minHeight 之类）；放不下时先省次要的行；
 *    只有尺寸固定、又没法省掉的紧凑控件才用 maxFontScaleConst.compact 封顶，
 *    正文、标题、说明不封顶；
 * 3. 登记到这里，在真机上用大字体看一遍。
 *
 * 主页（home 路由）底部的几个标签页各自登记在 fontScaleMigratedHomeTabs：标签页
 * 自己再包一层 FontScaleScope，盖过 home 路由那一层。
 *
 * 全部迁移完以后，ThemeText 改为默认跟随系统，删掉这份名单和 FontScaleScope。
 */
export const fontScaleMigratedRoutes: ReadonlySet<RoutePaths> = new Set<RoutePaths>(
    [
        "music-detail",
        "recommend-sheets",
        "top-list",
        "plugin-sheet-detail",
        "top-list-detail",
        "album-detail",
        "local-sheet-detail",
    ],
);

export const fontScaleMigratedPanels: ReadonlySet<keyof typeof panels> = new Set<
    keyof typeof panels
>(["SetUserVariables", "SheetTags", "MusicItemOptions", "AddToMusicSheet"]);

/**
 * 已经核对过的主页标签（HOME_TAB）。home 路由本身（标签栏和标签页外面的东西）
 * 不在 fontScaleMigratedRoutes 里，标签页逐个迁移。
 */
export const fontScaleMigratedHomeTabs: ReadonlySet<HomeTabName> = new Set<HomeTabName>(
    ["search-page"],
);
