package `fun`.upup.musicfree.mpvplayer

/**
 * Android Auto 打开“我喜欢”“最近播放”时等 JS 给内容的请求。同一个列表在 JS 回来之前又被打开，
 * 只向 JS 要一次，回来后一起答复。只在主线程用。
 */
internal class PendingBrowseRequests<R> {
    private val waiting = HashMap<String, MutableList<R>>()

    /** 返回 true 表示这个列表之前没人在等，要去向 JS 要 */
    fun add(parentId: String, result: R): Boolean {
        val list = waiting.getOrPut(parentId) { mutableListOf() }
        list.add(result)
        return list.size == 1
    }

    /** 取走这个列表所有在等的请求；没人在等（已经答复过或超时了）时是空的 */
    fun take(parentId: String): List<R> = waiting.remove(parentId).orEmpty()

    fun takeAll(): List<R> {
        val all = waiting.values.flatten()
        waiting.clear()
        return all
    }
}
