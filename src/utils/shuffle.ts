/**
 * 返回输入数组的乱序副本（不修改原数组），使用 Fisher-Yates 洗牌。
 * 行为与 lodash.shuffle 一致：输入不被改动，输出为新数组。
 */
export default function shuffle<T>(array: readonly T[]): T[] {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
