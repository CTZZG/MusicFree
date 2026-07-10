import { useMusicBarLayoutState } from "./layoutState";

export default function useMusicBarFloatingOffset(extraGap = 0) {
    const { layout } = useMusicBarLayoutState();

    return layout.reservedBottom ? layout.reservedBottom + extraGap : 0;
}
