import React from "react";
import {
    act,
    create,
    ReactTestRenderer,
} from "react-test-renderer";
import StateMapper, { GlobalState } from "../stateMapper";

describe("StateMapper", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("publishes a stable snapshot to every subscriber", () => {
        let source = { value: 1 };
        const mapper = new StateMapper(() => source);
        const snapshots: Array<{ value: number }> = [];

        function Probe() {
            snapshots.push(mapper.useMappedState());
            return null;
        }

        act(() => {
            renderer = create(
                <>
                    <Probe />
                    <Probe />
                </>,
            );
        });
        expect(snapshots.slice(-2)).toEqual([
            { value: 1 },
            { value: 1 },
        ]);

        source = { value: 2 };
        act(() => {
            mapper.notify();
        });
        expect(snapshots.slice(-2)).toEqual([
            { value: 2 },
            { value: 2 },
        ]);
        expect(snapshots.at(-1)).toBe(snapshots.at(-2));
    });

    it("unsubscribes after unmount", () => {
        const state = new GlobalState(1);
        let renderCount = 0;
        let latest = 0;

        function Probe() {
            latest = state.useValue();
            renderCount++;
            return null;
        }

        act(() => {
            renderer = create(<Probe />);
        });
        act(() => {
            state.setValue(previous => previous + 1);
        });
        expect(latest).toBe(2);
        expect(renderCount).toBe(2);

        act(() => {
            renderer!.unmount();
        });
        act(() => {
            state.setValue(3);
        });
        expect(renderCount).toBe(2);
    });

    it("rechecks the snapshot when the source changes during subscribe", () => {
        let source = 1;
        const mapper = new StateMapper(() => source);
        const originalSubscribe = mapper.subscribe;
        let changeDuringSubscribe = true;
        let latest = 0;

        mapper.subscribe = callback => {
            if (changeDuringSubscribe) {
                changeDuringSubscribe = false;
                source = 2;
                mapper.notify();
            }
            return originalSubscribe(callback);
        };

        function Probe() {
            latest = mapper.useMappedState();
            return null;
        }

        act(() => {
            renderer = create(<Probe />);
        });
        expect(latest).toBe(2);
    });

    it("keeps one active subscription in StrictMode and releases it", () => {
        const mapper = new StateMapper(() => 1);
        const originalSubscribe = mapper.subscribe;
        let activeSubscriptions = 0;

        mapper.subscribe = callback => {
            activeSubscriptions++;
            const unsubscribe = originalSubscribe(callback);
            let active = true;
            return () => {
                if (active) {
                    active = false;
                    activeSubscriptions--;
                }
                unsubscribe();
            };
        };

        function Probe() {
            mapper.useMappedState();
            return null;
        }

        act(() => {
            renderer = create(
                <React.StrictMode>
                    <Probe />
                </React.StrictMode>,
            );
        });
        expect(activeSubscriptions).toBe(1);

        act(() => {
            renderer!.unmount();
        });
        expect(activeSubscriptions).toBe(0);
    });
});
