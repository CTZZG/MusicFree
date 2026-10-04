import type panels from "@/components/panels/types";
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
 * 全部迁移完以后，ThemeText 改为默认跟随系统，删掉这份名单和 FontScaleScope。
 */
export const fontScaleMigratedRoutes: ReadonlySet<RoutePaths> = new Set<RoutePaths>(
    ["music-detail", "recommend-sheets"],
);

export const fontScaleMigratedPanels: ReadonlySet<keyof typeof panels> = new Set<
    keyof typeof panels
>(["SetUserVariables", "SheetTags"]);
