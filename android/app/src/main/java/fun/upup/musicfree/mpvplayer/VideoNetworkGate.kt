package `fun`.upup.musicfree.mpvplayer

/** The default network and consent are updated atomically from OS callbacks. */
internal class VideoNetworkGate {
    @Volatile var epoch = 0L
        private set
    private var initialized = false
    private var network: Long? = null
    private var internet = false
    private var validated = false
    private var unmetered = false
    private var meteredEnabled = false
    private var awaitingCapabilities = false
    private var pendingEpoch = -1L

    @Synchronized fun seed(id: Long?, internet: Boolean, validated: Boolean, unmetered: Boolean) {
        if (initialized) return
        initialized = true
        network = id
        this.internet = internet
        this.validated = validated
        this.unmetered = unmetered
        awaitingCapabilities = false
        epoch += 1L
    }

    @Synchronized fun available(id: Long): Long? {
        if (initialized && network == id) return null
        initialized = true
        network = id
        awaitingCapabilities = true
        internet = false
        validated = false
        unmetered = false
        epoch += 1L
        pendingEpoch = epoch
        return pendingEpoch
    }

    @Synchronized fun capabilities(id: Long, internet: Boolean, validated: Boolean, unmetered: Boolean) {
        if (network != id) return
        this.internet = internet
        this.validated = validated
        this.unmetered = unmetered
        awaitingCapabilities = false
        epoch += 1L
    }

    @Synchronized fun lost(id: Long) {
        if (network != id) return
        network = null
        awaitingCapabilities = false
        internet = false
        validated = false
        unmetered = false
        epoch += 1L
    }

    @Synchronized fun permitMetered(allowed: Boolean) {
        meteredEnabled = allowed
        epoch += 1L
    }

    @Synchronized fun allows(policy: String?): Boolean = policy == null ||
        (!awaitingCapabilities && network != null && internet && validated &&
            (unmetered || (policy == "allow-metered" && meteredEnabled)))

    /** Audio retry after engine retirement only blocks offline or unpermitted metered networks. */
    @Synchronized fun allowsAudioRetry(): Boolean =
        !awaitingCapabilities && network != null && (unmetered || meteredEnabled)

    /** Pending blocks new admissions, but is not proof an existing stream is denied. */
    @Synchronized fun denies(policy: String?): Boolean =
        policy != null && !awaitingCapabilities && !allows(policy)

    @Synchronized fun expirePending(id: Long, pendingEpoch: Long): Boolean {
        if (!awaitingCapabilities || network != id || this.pendingEpoch != pendingEpoch) return false
        awaitingCapabilities = false
        epoch += 1L
        return true
    }

    @Synchronized fun clearNetwork() {
        initialized = false
        network = null
        awaitingCapabilities = false
        internet = false
        validated = false
        unmetered = false
        epoch += 1L
    }
}
