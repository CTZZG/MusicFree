/** Use native Unicode segmentation where available. The fallback keeps common
 * emoji sequences, flags, combining marks and variation selectors intact on Hermes.
 * This is static share text only; it does not change lyric timing or tokenization.
 */
export function splitShareGraphemes(text: string): string[] {
    const Segmenter = (Intl as unknown as {
        Segmenter?: new (locale?: string, options?: { granularity: string }) => {
            segment(value: string): Iterable<{ segment: string }>;
        };
    }).Segmenter;
    if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), item => item.segment);
    const clusters: string[] = [];
    let regionalRun = 0;
    for (const point of Array.from(text)) {
        const regional = /[\u{1F1E6}-\u{1F1FF}]/u.test(point);
        const continuation = /[\p{Mark}\u200d\ufe0e\ufe0f\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(point);
        const previous = clusters[clusters.length - 1];
        if (previous && (continuation || previous.endsWith("\u200d") || (regional && regionalRun % 2 === 1))) {
            clusters[clusters.length - 1] += point;
        } else clusters.push(point);
        regionalRun = regional ? regionalRun + 1 : 0;
    }
    return clusters;
}
