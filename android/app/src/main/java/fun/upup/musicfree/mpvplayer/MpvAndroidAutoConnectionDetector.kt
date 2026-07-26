package `fun`.upup.musicfree.mpvplayer

import android.content.AsyncQueryHandler
import android.content.BroadcastReceiver
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.util.Log

/**
 * Detects Android Auto / Android Automotive connection state using the Android
 * for Cars connection provider.
 */
class MpvAndroidAutoConnectionDetector(
    private val context: Context,
) {
    companion object {
        private const val TAG = "MpvAndroidAutoConnection"
        private const val CAR_CONNECTION_STATE = "CarConnectionState"
        private const val ACTION_CAR_CONNECTION_UPDATED =
            "androidx.car.app.connection.action.CAR_CONNECTION_UPDATED"
        private const val QUERY_TOKEN = 42
        private const val CONNECTION_TYPE_NOT_CONNECTED = 0
        private const val CAR_CONNECTION_AUTHORITY = "androidx.car.app.connection"
        private val PROJECTION_HOST_URI =
            Uri.Builder()
                .scheme("content")
                .authority(CAR_CONNECTION_AUTHORITY)
                .build()
    }

    private val receiver = CarConnectionBroadcastReceiver()
    private val queryHandler = CarConnectionQueryHandler(context.contentResolver)
    @Volatile
    private var isRegistered = false

    @Volatile
    var onConnectionChanged: ((connected: Boolean, connectionType: Int) -> Unit)? = null

    @Synchronized
    fun register() {
        if (isRegistered) return

        try {
            val filter = IntentFilter(ACTION_CAR_CONNECTION_UPDATED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(receiver, filter)
            }
            isRegistered = true
            queryForState()
        } catch (error: Exception) {
            Log.w(TAG, "register failed", error)
            notifyDisconnected()
        }
    }

    @Synchronized
    fun unregister() {
        val wasRegistered = isRegistered
        isRegistered = false
        onConnectionChanged = null
        queryHandler.cancelOperation(QUERY_TOKEN)
        if (wasRegistered) {
            try {
                context.unregisterReceiver(receiver)
            } catch (error: Exception) {
                Log.w(TAG, "unregister failed", error)
            }
        }
    }

    private fun queryForState() {
        if (!isRegistered) return
        try {
            queryHandler.startQuery(
                QUERY_TOKEN,
                null,
                PROJECTION_HOST_URI,
                arrayOf(CAR_CONNECTION_STATE),
                null,
                null,
                null,
            )
        } catch (error: Exception) {
            Log.w(TAG, "query failed", error)
            notifyDisconnected()
        }
    }

    private fun notifyDisconnected() {
        onConnectionChanged?.invoke(false, CONNECTION_TYPE_NOT_CONNECTED)
    }

    private fun notifyConnected(connectionType: Int) {
        onConnectionChanged?.invoke(true, connectionType)
    }

    private inner class CarConnectionBroadcastReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            queryForState()
        }
    }

    private inner class CarConnectionQueryHandler(
        resolver: ContentResolver?,
    ) : AsyncQueryHandler(resolver) {
        override fun onQueryComplete(
            token: Int,
            cookie: Any?,
            response: Cursor?,
        ) {
            response.use { cursor ->
                if (!isRegistered) {
                    return
                }
                if (cursor == null) {
                    notifyDisconnected()
                    return
                }

                val stateColumn = cursor.getColumnIndex(CAR_CONNECTION_STATE)
                if (stateColumn < 0 || !cursor.moveToNext()) {
                    notifyDisconnected()
                    return
                }

                val connectionType = cursor.getInt(stateColumn)
                if (connectionType == CONNECTION_TYPE_NOT_CONNECTED) {
                    notifyDisconnected()
                } else {
                    notifyConnected(connectionType)
                }
            }
        }
    }
}
