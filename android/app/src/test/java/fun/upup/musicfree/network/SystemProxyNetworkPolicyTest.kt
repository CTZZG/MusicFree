package `fun`.upup.musicfree.network

import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketAddress
import java.net.URI
import java.net.UnknownHostException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Dns
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SystemProxyNetworkPolicyTest {
    private fun selector(proxies: List<Proxy>) = object : ProxySelector() {
        override fun select(uri: URI): List<Proxy> = proxies
        override fun connectFailed(uri: URI, sa: SocketAddress, ioe: IOException) {}
    }

    private fun proxy(server: MockWebServer) =
        Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", server.port))

    @Test
    fun `public artwork can load through the system-selected loopback HTTP proxy`() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse().setBody("cover"))
            val client = PublicHttpsNetworkPolicy.clientBuilderForTesting(
                Dns.SYSTEM,
                selector(listOf(proxy(server))),
                PublicHttpsNetworkPolicy.RedirectScope.CROSS_ORIGIN,
            ).build()

            client.newCall(Request.Builder().url("http://public.test/cover.jpg").build())
                .execute().use { response ->
                    assertEquals(200, response.code)
                    assertEquals("cover", response.body?.string())
                }
            assertEquals("GET http://public.test/cover.jpg HTTP/1.1", server.takeRequest().requestLine)
        }
    }

    @Test
    fun `system proxy supplied as a local hostname is resolved as a transport endpoint`() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse().setBody("cover"))
            val httpProxy = Proxy(
                Proxy.Type.HTTP,
                InetSocketAddress.createUnresolved("localhost", server.port),
            )
            val client = PublicHttpsNetworkPolicy.clientBuilderForTesting(
                Dns.SYSTEM,
                selector(listOf(httpProxy)),
            ).build()

            client.newCall(Request.Builder().url("http://public.test/cover.jpg").build())
                .execute().use { response -> assertEquals(200, response.code) }
        }
    }

    @Test
    fun `a rejected connection can fall back to another selected HTTP proxy`() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse().setBody("cover"))
            val unavailable = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", 1))
            val client = PublicHttpsNetworkPolicy.clientBuilderForTesting(
                Dns.SYSTEM,
                selector(listOf(unavailable, proxy(server))),
            ).connectTimeout(1, TimeUnit.SECONDS).build()

            client.newCall(Request.Builder().url("http://public.test/cover.jpg").build())
                .execute().use { response -> assertEquals(200, response.code) }
        }
    }

    @Test
    fun `remote loopback URL stays blocked even when the selected proxy is loopback`() {
        MockWebServer().use { server ->
            server.start()
            val client = PublicHttpsNetworkPolicy.clientBuilderForTesting(
                Dns.SYSTEM,
                selector(listOf(proxy(server))),
            ).build()
            assertThrows(IllegalArgumentException::class.java) {
                client.newCall(Request.Builder().url("http://127.0.0.1/private.jpg").build())
                    .execute().close()
            }
            assertEquals(0, server.requestCount)
        }
    }

    @Test
    fun `direct destination with a private DNS answer stays blocked`() {
        val privateDns = object : Dns {
            override fun lookup(hostname: String) = listOf(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
        }
        val client = PublicHttpsNetworkPolicy.clientBuilderForTesting(
            privateDns,
            selector(listOf(Proxy.NO_PROXY)),
        ).build()
        assertThrows(UnknownHostException::class.java) {
            client.newCall(Request.Builder().url("http://public.test/private.jpg").build())
                .execute().close()
        }
    }

    @Test
    fun `a direct route cannot reuse an exemption from a previous proxy selection`() {
        val privateDns = object : Dns {
            override fun lookup(hostname: String) = listOf(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
        }
        val proxySelector = object : ProxySelector() {
            override fun select(uri: URI): List<Proxy> = if (uri.host == "artwork.test") {
                listOf(Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved("proxy.test", 7890)))
            } else {
                listOf(Proxy.NO_PROXY)
            }
            override fun connectFailed(uri: URI, sa: SocketAddress, ioe: IOException) {}
        }
        val client = PublicHttpsNetworkPolicy.clientBuilderForTesting(privateDns, proxySelector).build()
        client.proxySelector.select(URI("http://artwork.test/cover.jpg"))
        assertEquals("127.0.0.1", client.dns.lookup("proxy.test").single().hostAddress)
        client.proxySelector.select(URI("http://proxy.test/private.jpg"))
        assertThrows(UnknownHostException::class.java) { client.dns.lookup("proxy.test") }
    }

    @Test
    fun `a proxy DNS exemption is not shared with another call thread`() {
        val httpProxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", 7890))
        val client = PublicHttpsNetworkPolicy.clientBuilderForTesting(
            Dns.SYSTEM,
            selector(listOf(httpProxy)),
        ).build()
        client.proxySelector.select(URI("http://public.test/cover.jpg"))
        assertEquals("127.0.0.1", client.dns.lookup("127.0.0.1").single().hostAddress)
        val executor = Executors.newSingleThreadExecutor()
        try {
            executor.submit {
                assertThrows(UnknownHostException::class.java) { client.dns.lookup("127.0.0.1") }
            }.get(5, TimeUnit.SECONDS)
        } finally {
            executor.shutdownNow()
        }
    }
}
