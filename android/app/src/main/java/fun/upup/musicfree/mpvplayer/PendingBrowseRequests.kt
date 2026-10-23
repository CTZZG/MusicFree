package `fun`.upup.musicfree.mpvplayer

import java.util.UUID

/**
 * Android Auto 打开“我喜欢”“最近播放”时等 JS 给内容的请求。同一个列表在 JS 回来之前又被打开，
 * 只向 JS 要一次，回来后一起答复。只在主线程用。
 */
internal class PendingBrowseRequests<R> {
    private class Request<R>(val id: String, val results: MutableList<R>)
    private val waiting = HashMap<String, Request<R>>()

    /** 首个等待者获得一次请求的编号；同一批的后续等待者合并，不再向 JS 请求。 */
    fun add(parentId: String, result: R): String? {
        waiting[parentId]?.let {
            it.results.add(result)
            return null
        }
        val request = Request(UUID.randomUUID().toString(), mutableListOf(result))
        waiting[parentId] = request
        return request.id
    }

    /** 取走这个列表所有在等的请求；没人在等（已经答复过或超时了）时是空的 */
    fun take(parentId: String, requestId: String): List<R> {
        val request = waiting[parentId] ?: return emptyList()
        // 超时后重新打开了相同列表：旧答复和旧超时都不能取走新的等待者。
        if (request.id != requestId) return emptyList()
        waiting.remove(parentId)
        return request.results
    }

    fun takeAll(): List<R> {
        val all = waiting.values.flatMap { it.results }
        waiting.clear()
        return all
    }
}
