package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.*
import org.junit.Test

class VideoNetworkGateTest {
    @Test fun pendingCapabilitiesAreNotADenialAndPermissionUpdatesCannotPreventTheTimeout() {
        val gate = VideoNetworkGate()
        gate.seed(1, true, true, true)
        val pending = gate.available(2)!!
        assertFalse(gate.allows("unmetered"))
        assertFalse(gate.denies("unmetered"))
        gate.permitMetered(false)
        assertTrue(gate.expirePending(2, pending))
        assertTrue(gate.denies("unmetered"))
        assertFalse(gate.expirePending(2, pending))
    }

    @Test fun unknownAndUnvalidatedNetworksFailClosed() {
        val gate = VideoNetworkGate()
        assertFalse(gate.allows("unmetered"))
        gate.available(1)
        assertFalse(gate.allows("unmetered"))
        gate.capabilities(1, true, false, true)
        assertFalse(gate.allows("unmetered"))
        gate.capabilities(1, true, true, true)
        assertTrue(gate.allows("unmetered"))
    }

    @Test fun switchingToCellularRequiresBothGlobalPermissionAndSessionConsent() {
        val gate = VideoNetworkGate()
        gate.seed(1, true, true, true)
        gate.available(2)
        gate.capabilities(2, true, true, false)
        assertFalse(gate.allows("unmetered"))
        assertFalse(gate.allows("allow-metered"))
        gate.permitMetered(true)
        assertFalse(gate.allows("unmetered"))
        assertTrue(gate.allows("allow-metered"))
        gate.permitMetered(false)
        assertFalse(gate.allows("allow-metered"))
    }

    @Test fun staleOldNetworkCallbacksCannotRevokeOrAuthorizeTheNewDefault() {
        val gate = VideoNetworkGate()
        gate.seed(1, true, true, true)
        gate.available(2)
        gate.capabilities(2, true, true, true)
        val epoch = gate.epoch
        gate.lost(1)
        gate.capabilities(1, false, false, false)
        assertEquals(epoch, gate.epoch)
        assertTrue(gate.allows("unmetered"))
    }

    @Test fun losingUnmeteredOnTheSameNetworkRevokesReading() {
        val gate = VideoNetworkGate()
        gate.seed(1, true, true, true)
        gate.capabilities(1, true, true, false)
        assertFalse(gate.allows("unmetered"))
    }

    @Test fun lossOfInternetOrDefaultNetworkRevokesEvenAnApprovedSession() {
        val gate = VideoNetworkGate()
        gate.seed(1, true, true, false)
        gate.permitMetered(true)
        assertTrue(gate.allows("allow-metered"))
        gate.capabilities(1, false, true, false)
        assertFalse(gate.allows("allow-metered"))
        gate.capabilities(1, true, true, false)
        gate.lost(1)
        assertFalse(gate.allows("allow-metered"))
    }

    @Test fun aSeedCannotOverwriteAnAlreadyDeliveredOsCallback() {
        val gate = VideoNetworkGate()
        gate.available(2)
        gate.capabilities(2, true, true, false)
        gate.seed(1, true, true, true)
        assertFalse(gate.allows("unmetered"))
    }

    @Test fun engineRecreationNeedsANewNetworkReading() {
        val gate = VideoNetworkGate()
        gate.seed(1, true, true, true)
        gate.clearNetwork()
        assertFalse(gate.allows("unmetered"))
        gate.seed(2, true, true, true)
        assertTrue(gate.allows("unmetered"))
    }

    @Test fun audioDoesNotInheritAVideoNetworkRestriction() {
        val gate = VideoNetworkGate()
        assertTrue(gate.allows(null))
    }

    @Test fun audioRetryAllowsUnvalidatedUnmeteredLanWhileStillBlockingOfflineAndUnpermittedMetered() {
        val gate = VideoNetworkGate()
        assertFalse(gate.allowsAudioRetry())
        gate.seed(1, internet = true, validated = false, unmetered = true)
        assertFalse(gate.allows("allow-metered"))
        assertTrue(gate.allowsAudioRetry())
        gate.capabilities(1, internet = true, validated = true, unmetered = false)
        assertFalse(gate.allowsAudioRetry())
        gate.permitMetered(true)
        assertTrue(gate.allowsAudioRetry())
        gate.lost(1)
        assertFalse(gate.allowsAudioRetry())
    }
}
