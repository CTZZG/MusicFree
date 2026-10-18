package `fun`.upup.musicfree.network

import java.io.File
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import org.junit.Assert.assertEquals
import org.junit.Test

/** The extra root in network_security_config.xml must be exactly ISRG Root X1, next to the system roots. */
class BundledTrustAnchorsTest {
    private val resDir = File("src/main/res")

    @Test
    fun bundledRootIsIsrgRootX1() {
        val certificate = File(resDir, "raw/isrg_root_x1.pem").inputStream().use {
            CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate
        }
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
            .joinToString("") { "%02X".format(it) }

        assertEquals(ISRG_ROOT_X1_SHA256, fingerprint)
        assertEquals(
            "CN=ISRG Root X1,O=Internet Security Research Group,C=US",
            certificate.subjectX500Principal.name,
        )
    }

    @Test
    fun networkSecurityConfigTrustsSystemRootsAndTheBundledRootOnly() {
        val config = File(resDir, "xml/network_security_config.xml").readText()
        val anchors = Regex("""<certificates\s+src="([^"]+)"""")
            .findAll(config)
            .map { it.groupValues[1] }
            .toList()

        assertEquals(listOf("system", "@raw/isrg_root_x1"), anchors)
    }

    private companion object {
        const val ISRG_ROOT_X1_SHA256 =
            "96BCEC06264976F37460779ACF28C5A7CFE8A3C0AAE11A8FFCEE05C0BDDF08C6"
    }
}
