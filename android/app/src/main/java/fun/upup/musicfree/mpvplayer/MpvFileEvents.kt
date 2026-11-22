package `fun`.upup.musicfree.mpvplayer

/** File IDs come from loadfile's result, never a URL or a callback-time owner. */
internal class MpvFileEvents<T> {
    enum class Reason { EOF, STOP, QUIT, ERROR, REDIRECT, UNKNOWN }

    data class File<T>(
        val id: Long, val owner: T, val kind: String, val rootId: Long, var prepared: Boolean,
        var started: Boolean = false, var loaded: Boolean = false, var ended: Boolean = false,
        var restarted: Boolean = false,
    )
    data class End<T>(val file: File<T>, val reason: Reason, val error: Int)

    private val files = linkedMapOf<Long, File<T>>()
    private val multipartOwners = mutableSetOf<T>()
    @Volatile var epoch: Long = 0L
        private set
    var explicitRoot: Long? = null
        private set

    @Synchronized fun reset() {
        epoch += 1L
        clear()
    }

    fun clear() {
        files.clear()
        multipartOwners.clear()
        explicitRoot = null
    }

    fun replace(id: Long, owner: T, kind: String) {
        require(id >= 0L) { "Missing mpv playlist entry ID" }
        files.clear()
        multipartOwners.clear()
        explicitRoot = id
        files[id] = File(id, owner, kind, id, false)
    }

    fun append(id: Long, owner: T, sourceId: Long) {
        require(id >= 0L && id !in files) { "Invalid prepared entry ID" }
        val source = files[sourceId] ?: error("Prepared source no longer owned")
        require(source.rootId == explicitRoot) { "Prepared source was superseded" }
        files[id] = File(id, owner, "audio", source.rootId, true)
        prune()
    }

    fun get(id: Long): File<T>? = files[id]?.takeIf { it.rootId == explicitRoot }
    fun start(id: Long): File<T>? = get(id)?.takeUnless { it.ended }?.also { it.started = true }
    fun loaded(id: Long): File<T>? = get(id)?.takeUnless { it.ended }?.also { it.loaded = true }
    fun restarted(id: Long): File<T>? = get(id)?.takeUnless { it.ended }?.also { it.restarted = true }
    fun ready(id: Long): File<T>? = get(id)?.takeIf { !it.ended && it.loaded && it.restarted }

    fun preparedEntry(id: Long, sourceId: Long): File<T>? {
        val source = get(sourceId) ?: return null
        return get(id)?.takeIf { !it.ended && it.prepared && it.owner == source.owner && it.rootId == source.rootId }
    }

    fun promotePrepared(id: Long, sourceId: Long): File<T>? =
        preparedEntry(id, sourceId)?.also { promoted ->
            files.values.filter { it.owner == promoted.owner && it.rootId == promoted.rootId }
                .forEach { it.prepared = false }
        }

    fun hasContinuation(file: File<T>): Boolean = files.values.any {
        !it.ended && it.id != file.id && it.owner == file.owner && it.rootId == file.rootId
    }

    fun isMultipart(owner: T): Boolean = owner in multipartOwners

    fun end(eventEpoch: Long, id: Long, reason: Int, error: Int, insertId: Long, insertCount: Int): End<T>? {
        if (eventEpoch != epoch) return null
        val file = get(id)?.takeUnless { it.ended } ?: return null
        file.ended = true
        val classified = if (error < 0) Reason.ERROR else when (reason) {
            0 -> Reason.EOF
            2 -> Reason.STOP
            3 -> Reason.QUIT
            4 -> Reason.ERROR
            5 -> Reason.REDIRECT
            else -> Reason.UNKNOWN
        }
        if (classified == Reason.REDIRECT) {
            if (insertId < 0L || insertCount !in 1..128 || insertId > Long.MAX_VALUE - (insertCount - 1) ||
                files.values.count { !it.ended } + insertCount > 256) {
                return End(file, Reason.ERROR, error)
            }
            val children = (0 until insertCount).map { insertId + it }
            if (children.any { it in files }) return End(file, Reason.ERROR, error)
            if (insertCount > 1) multipartOwners.add(file.owner)
            children.forEach { child ->
                files[child] = File(child, file.owner, file.kind, file.rootId, file.prepared)
            }
            prune()
        }
        return End(file, classified, error)
    }

    fun discardPrepared(): Set<Long> {
        val ids = files.values.filter { it.prepared }.map { it.id }.toSet()
        ids.forEach { files.remove(it) }
        return ids
    }

    private fun prune() {
        val iterator = files.entries.iterator()
        while (files.size > 256 && iterator.hasNext()) {
            if (iterator.next().value.ended) iterator.remove()
        }
        check(files.size <= 256) { "Too many active mpv entries" }
        multipartOwners.retainAll(files.values.map { it.owner }.toSet())
    }
}
