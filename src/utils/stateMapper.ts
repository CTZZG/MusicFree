import { useSyncExternalStore } from "react";

export default class StateMapper<T> {
    private readonly getFun: () => T;
    private readonly cbs = new Set<() => void>();
    private snapshot: T;
    public readonly useMappedState: () => T;

    constructor(getFun: () => T) {
        this.getFun = getFun;
        this.snapshot = getFun();
        this.useMappedState = createStateMapperHook(this);
    }

    notify = () => {
        this.snapshot = this.getFun();
        this.cbs.forEach(callback => callback());
    };

    getSnapshot = () => this.snapshot;

    subscribe = (callback: () => void) => {
        this.cbs.add(callback);
        return () => {
            this.cbs.delete(callback);
        };
    };
}

function createStateMapperHook<T>(stateMapper: StateMapper<T>) {
    return function useMappedState() {
        return useSyncExternalStore(
            stateMapper.subscribe,
            stateMapper.getSnapshot,
            stateMapper.getSnapshot,
        );
    };
}

type UpdateFunc<T> = (prev: T) => T;

export class GlobalState<T> {
    private value: T;
    private stateMapper: StateMapper<T>;

    constructor(initValue: T) {
        this.value = initValue;
        this.stateMapper = new StateMapper(this.getValue);
    }

    public getValue = () => {
        return this.value;
    };

    public useValue = () => {
        return this.stateMapper.useMappedState();
    };

    public setValue = (value: T | UpdateFunc<T>) => {
        let newValue: T;
        if (typeof value === "function") {
            newValue = (value as UpdateFunc<T>)(this.value);
        } else {
            newValue = value;
        }

        this.value = newValue;
        this.stateMapper.notify();
    };
}
