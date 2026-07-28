package `fun`.upup.musicfree.qmc

import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal class QmcSessionRegistry<T>(
    private val maxSessions: Int,
    private val idleTimeoutMs: Long,
    private val now: () -> Long = System::currentTimeMillis,
) {
    init {
        require(maxSessions > 0) { "QMC session capacity must be positive" }
        require(idleTimeoutMs > 0L) { "QMC session idle timeout must be positive" }
    }

    private val entries = LinkedHashMap<String, Entry<T>>()

    @Synchronized
    fun register(id: String, value: T) {
        require(id.isNotBlank()) { "QMC session id is required" }
        val currentTime = now()
        evictIdleLocked(currentTime)
        while (entries.size >= maxSessions) {
            val oldestInactive = entries.entries
                .filter { it.value.activeRequests == 0 }
                .minWithOrNull(
                    compareBy<Map.Entry<String, Entry<T>>> { it.value.lastAccessAt }
                        .thenBy { it.value.createdAt },
                )
                ?: throw IllegalStateException("QMC proxy session capacity is busy")
            entries.remove(oldestInactive.key)
        }
        entries[id] = Entry(
            value = value,
            createdAt = currentTime,
            lastAccessAt = currentTime,
        )
    }

    @Synchronized
    fun acquire(id: String): Lease<T>? {
        val currentTime = now()
        evictIdleLocked(currentTime)
        val entry = entries[id] ?: return null
        val lease = Lease(this, id, entry)
        entry.activeRequests += 1
        entry.activeLeases += lease
        entry.lastAccessAt = currentTime
        return lease
    }

    @Synchronized
    fun evictIdle(): Int = evictIdleLocked(now())

    fun clear() {
        val activeLeases = synchronized(this) {
            entries.values
                .flatMap { it.activeLeases }
                .also { entries.clear() }
        }
        var closeFailure: Throwable? = null
        activeLeases.forEach { lease ->
            try {
                lease.close()
            } catch (error: Throwable) {
                if (closeFailure == null) {
                    closeFailure = error
                } else {
                    closeFailure!!.addSuppressed(error)
                }
            }
        }
        closeFailure?.let { throw it }
    }

    @Synchronized
    internal fun contains(id: String) = entries.containsKey(id)

    @get:Synchronized
    internal val size: Int
        get() = entries.size

    @Synchronized
    private fun release(id: String, entry: Entry<T>, lease: Lease<T>) {
        if (!entry.activeLeases.remove(lease)) return
        check(entry.activeRequests > 0) { "QMC session lease underflow" }
        entry.activeRequests -= 1
        if (entries[id] === entry) {
            entry.lastAccessAt = now()
        }
    }

    private fun evictIdleLocked(currentTime: Long): Int {
        val expired = entries
            .filterValues { entry ->
                entry.activeRequests == 0 &&
                    currentTime - entry.lastAccessAt >= idleTimeoutMs
            }
            .keys
            .toList()
        expired.forEach(entries::remove)
        return expired.size
    }

    internal class Entry<T>(
        val value: T,
        val createdAt: Long,
        var lastAccessAt: Long,
        var activeRequests: Int = 0,
        val activeLeases: MutableSet<Lease<T>> = mutableSetOf(),
    )

    internal class Lease<T> internal constructor(
        private val owner: QmcSessionRegistry<T>,
        private val id: String,
        private val entry: Entry<T>,
    ) : Closeable {
        private val closed = AtomicBoolean(false)
        private val resource = AtomicReference<Closeable?>(null)
        val value: T
            get() = entry.value

        fun attach(resource: Closeable) {
            check(this.resource.compareAndSet(null, resource)) {
                "QMC session lease already owns a response body"
            }
            if (closed.get()) {
                closeAttachedResource()
            }
        }

        override fun close() {
            if (closed.compareAndSet(false, true)) {
                try {
                    closeAttachedResource()
                } finally {
                    owner.release(id, entry, this)
                }
            }
        }

        private fun closeAttachedResource() {
            resource.getAndSet(null)?.close()
        }
    }
}
