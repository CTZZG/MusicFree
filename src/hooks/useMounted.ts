import { useCallback, useEffect, useRef, useState } from "react";

export function useOnMounted() {
    const onMounted = useRef(false);
    const [isLoading, setLoading] = useState(true);

    useEffect(() => {
        onMounted.current = true;
        const timer = setTimeout(() => {
            setLoading(false);
        });

        return () => {
            onMounted.current = false;
            clearTimeout(timer);
        };
    }, []);

    return { onMounted: useCallback(() => onMounted.current, []), isLoading };
}
