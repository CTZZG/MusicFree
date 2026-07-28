package `fun`.upup.musicfree.qmc

internal class QmcProxyLifecycle {
    private var nextOwnerId = 0L
    private val activeOwners = mutableSetOf<Long>()

    @Synchronized
    fun attachOwner(): Long {
        val ownerId = ++nextOwnerId
        activeOwners += ownerId
        return ownerId
    }

    @Synchronized
    fun <T> withActiveOwner(ownerId: Long, operation: () -> T): T {
        check(activeOwners.contains(ownerId)) { "QMC proxy owner is inactive" }
        return operation()
    }

    @Synchronized
    fun detachOwner(ownerId: Long, onLastOwnerDetached: () -> Unit) {
        if (!activeOwners.remove(ownerId)) return
        if (activeOwners.isEmpty()) {
            onLastOwnerDetached()
        }
    }
}
