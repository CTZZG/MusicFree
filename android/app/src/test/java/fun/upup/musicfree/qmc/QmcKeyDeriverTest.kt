package `fun`.upup.musicfree.qmc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class QmcKeyDeriverTest {
    @Test
    fun simpleKeyMatchesUnlockMusicKnownAnswer() {
        assertArrayEquals(
            byteArrayOf(0x69, 0x56, 0x46, 0x38, 0x2b, 0x20, 0x15, 0x0b),
            QmcKeyDeriver.simpleMakeKey(106, 8),
        )
    }

    @Test
    fun derivesRealMapKeyVectorPublishedWithUnlockMusic() {
        val encodedKey = MFLAC_MAP_KEY_RAW.toByteArray(Charsets.US_ASCII)
        val expected = MFLAC_MAP_KEY.toByteArray(Charsets.US_ASCII)
        assertArrayEquals(expected, QmcKeyDeriver.derive(encodedKey))
    }

    @Test
    fun rejectsMalformedAndOversizedKeys() {
        assertThrows(IllegalArgumentException::class.java) {
            QmcKeyDeriver.derive("not base64!!!")
        }
        assertThrows(IllegalArgumentException::class.java) {
            QmcKeyDeriver.derive("A".repeat(QmcKeyDeriver.MAX_ENCODED_KEY_LENGTH + 1))
        }
    }

    private companion object {
        const val MFLAC_MAP_KEY_RAW =
            "eXc3eFdPeU6+3f7GVeF35bMpIEIQj5JWOWt7G+jsR68Hx3BUFBavkTQ8dpPdP0XBIwPe+OfdsnTGVQqPyg3GCtQSrkgA0mwSQdr4DPzKLkEZFX+Cf1V6ChyipOuC6KT37eAxWMdV1UHf9/OCvydr1dc6SWK1ijRUcP6IAHQhiB+mZLay7XXrSPo32WjdBkn9c9sa2SLtI48atj5kfZ4oOq6QGeld2JA3Z+3wwCe6uTHthKaEHY8ufDYodEe3qqrjYpzkdx55pCtxCQa1JiNqFmJigWm4m3CDzhuJ7YqnjbD+mXxLi7BP1+z4L6nccE2h+DGHVqpGjR9+4LBpe4WHB4DrAzVp2qQRRQJxeHd1v88="
        const val MFLAC_MAP_KEY =
            "yw7xWOyNQ8585Jwx3hjB49QLPKi38F89awnrQ0fq66NT9TDq1ppHNrFqhaDrU5AFk916D58I53h86304GqOFCCyFzBem68DqiXJ81bILEQwG3P3MOnoNzM820kNW9Lv9IJGNn9Xo497p82BLTm4hAX8JLBs0T2pilKvT429sK9jfg508GSk4d047Jxdz5Fou4aa33OkyFRBU3x430mgNBn04Lc9BzXUI2IGYXv3FGa9qE4Vb54kSjVv8ogbg47j3"
    }
}
