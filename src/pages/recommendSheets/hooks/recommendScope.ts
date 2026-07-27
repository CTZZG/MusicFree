const functionIds = new WeakMap<Function, number>();
const localSymbolIds = new Map<symbol, number>();
let nextFunctionId = 1;
let nextLocalSymbolId = 1;

function getFunctionId(value: Function) {
    const existing = functionIds.get(value);
    if (existing) {
        return existing;
    }
    const identity = nextFunctionId++;
    functionIds.set(value, identity);
    return identity;
}

function serializeNumber(value: number) {
    if (Number.isNaN(value)) {
        return "number:NaN";
    }
    if (value === Infinity) {
        return "number:Infinity";
    }
    if (value === -Infinity) {
        return "number:-Infinity";
    }
    if (Object.is(value, -0)) {
        return "number:-0";
    }
    return `number:${value}`;
}

function serializeSymbol(value: symbol) {
    const globalKey = Symbol.keyFor(value);
    if (globalKey !== undefined) {
        return `symbol:global:${JSON.stringify(globalKey)}`;
    }
    let identity = localSymbolIds.get(value);
    if (!identity) {
        identity = nextLocalSymbolId++;
        localSymbolIds.set(value, identity);
    }
    return `symbol:local:${identity}:${JSON.stringify(
        value.description ?? "",
    )}`;
}

function serializePropertyKey(value: PropertyKey) {
    return typeof value === "symbol"
        ? serializeSymbol(value)
        : `key:${JSON.stringify(value)}`;
}

function stableSerialize(
    value: unknown,
    references: Map<object, number>,
): string {
    if (value === null) {
        return "null";
    }

    switch (typeof value) {
    case "undefined":
        return "undefined";
    case "boolean":
        return `boolean:${value}`;
    case "number":
        return serializeNumber(value);
    case "bigint":
        return `bigint:${value}`;
    case "string":
        return `string:${JSON.stringify(value)}`;
    case "symbol":
        return serializeSymbol(value);
    case "function":
        return `function:${getFunctionId(value)}`;
    }

    const objectValue = value as object;
    const existingReference = references.get(objectValue);
    if (existingReference !== undefined) {
        return `reference:${existingReference}`;
    }
    const reference = references.size;
    references.set(objectValue, reference);

    if (Array.isArray(value)) {
        const items = Array.from({ length: value.length }, (_, index) =>
            index in value
                ? stableSerialize(value[index], references)
                : "array-hole",
        );
        return `array:${reference}:[${items.join(",")}]`;
    }
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return `date:${reference}:${
            Number.isNaN(timestamp) ? "invalid" : value.toISOString()
        }`;
    }
    if (value instanceof RegExp) {
        return `regexp:${reference}:${value.toString()}`;
    }
    if (value instanceof Map) {
        const entries = Array.from(value.entries(), ([key, item]) =>
            `${stableSerialize(key, references)}=>${stableSerialize(
                item,
                references,
            )}`,
        );
        return `map:${reference}:{${entries.join(",")}}`;
    }
    if (value instanceof Set) {
        const items = Array.from(value, item =>
            stableSerialize(item, references),
        );
        return `set:${reference}:{${items.join(",")}}`;
    }

    const entries = Reflect.ownKeys(objectValue)
        .filter(key =>
            Object.prototype.propertyIsEnumerable.call(objectValue, key),
        )
        .map(key => ({
            key,
            serializedKey: serializePropertyKey(key),
        }))
        .sort((left, right) =>
            left.serializedKey.localeCompare(right.serializedKey),
        )
        .map(({ key, serializedKey }) => {
            const descriptor = Object.getOwnPropertyDescriptor(
                objectValue,
                key,
            );
            if (!descriptor) {
                return `${serializedKey}:missing`;
            }
            const serializedValue = "value" in descriptor
                ? stableSerialize(descriptor.value, references)
                : [
                    "accessor",
                    stableSerialize(descriptor.get, references),
                    stableSerialize(descriptor.set, references),
                ].join(":");
            return `${serializedKey}:${serializedValue}`;
        });
    return `object:${reference}:{${entries.join(",")}}`;
}

export function createRecommendScopeKey(
    pluginHash: string,
    tag: ICommon.IUnique,
) {
    return `${JSON.stringify(pluginHash)}\u0000${stableSerialize(
        tag,
        new Map(),
    )}`;
}
