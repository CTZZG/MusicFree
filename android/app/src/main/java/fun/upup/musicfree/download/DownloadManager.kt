package `fun`.upup.musicfree.download

import android.content.Context
import java.io.File
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

class DownloadManager(
    context: Context,
    private val listener: Listener,
) {
    interface Listener {
        fun onTaskStatusChanged(task: DownloadTask)
        fun onProgressBatch(items: List<ProgressSnapshot>)
        fun onQueueDrained()
    }

    private data class RunningTask(
        val control: DownloadExecutor.ExecutionControl,
        val future: Future<*>,
    )

    private val appContext = context.applicationContext
    private val database = DownloadDatabase(appContext)
    private val notificationManager = DownloadNotificationManager(appContext)

    private val downloadClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .connectionPool(ConnectionPool(16, 5, TimeUnit.MINUTES))
            .build()
    }
    private val downloadExecutor = DownloadExecutor(downloadClient)

    private val tasks = ConcurrentHashMap<String, DownloadTask>()
    private val pendingQueue = ConcurrentLinkedQueue<String>()
    private val runningTasks = ConcurrentHashMap<String, RunningTask>()
    private val progressCache = ConcurrentHashMap<String, ProgressSnapshot>()

    private val dispatcherExecutor = Executors.newSingleThreadExecutor()
    private val workerExecutor = Executors.newCachedThreadPool()
    private val progressFlushExecutor = Executors.newSingleThreadScheduledExecutor()
    private val lock = Any()

    @Volatile
    private var maxConcurrency = 3

    init {
        restoreTasksFromDb()
        progressFlushExecutor.scheduleAtFixedRate(
            {
                flushProgressBatch()
            },
            500,
            500,
            TimeUnit.MILLISECONDS,
        )
    }

    fun setMaxConcurrency(value: Int) {
        maxConcurrency = value.coerceIn(1, 10)
        dispatchAsync()
    }

    fun addTask(task: DownloadTask): Boolean {
        synchronized(lock) {
            val existing = tasks[task.taskId]
            if (existing != null && existing.status != DownloadTaskStatus.ERROR && existing.status != DownloadTaskStatus.CANCELED) {
                return false
            }

            val normalized = task.copy(
                status = DownloadTaskStatus.PENDING,
                errorMessage = null,
                updatedAt = System.currentTimeMillis(),
            )
            tasks[task.taskId] = normalized
            pendingQueue.offer(task.taskId)
            database.upsertTask(normalized)
            emitStatusChanged(normalized)
        }
        dispatchAsync()
        return true
    }

    fun pauseTask(taskId: String): Boolean {
        synchronized(lock) {
            val task = tasks[taskId] ?: return false
            return when (task.status) {
                DownloadTaskStatus.PENDING -> {
                    removeFromQueue(taskId)
                    updateTaskStatus(
                        task = task,
                        status = DownloadTaskStatus.PAUSED,
                        errorMessage = null,
                    )
                    true
                }
                DownloadTaskStatus.PREPARING,
                DownloadTaskStatus.DOWNLOADING,
                -> {
                    runningTasks[taskId]?.control?.pause()
                    true
                }
                else -> false
            }
        }
    }

    fun resumeTask(taskId: String): Boolean {
        synchronized(lock) {
            val task = tasks[taskId] ?: return false
            if (task.status != DownloadTaskStatus.PAUSED && task.status != DownloadTaskStatus.ERROR) {
                return false
            }
            updateTaskStatus(
                task = task,
                status = DownloadTaskStatus.PENDING,
                errorMessage = null,
            )
            pendingQueue.offer(taskId)
        }
        dispatchAsync()
        return true
    }

    fun cancelTask(taskId: String): Boolean {
        synchronized(lock) {
            val task = tasks[taskId] ?: return false
            when (task.status) {
                DownloadTaskStatus.PREPARING,
                DownloadTaskStatus.DOWNLOADING,
                -> {
                    runningTasks[taskId]?.control?.cancel()
                    return true
                }
                DownloadTaskStatus.PENDING,
                DownloadTaskStatus.PAUSED,
                DownloadTaskStatus.ERROR,
                -> {
                    removeFromQueue(taskId)
                    updateTaskStatus(
                        task = task,
                        status = DownloadTaskStatus.CANCELED,
                        errorMessage = null,
                    )
                    tasks.remove(taskId)
                    database.deleteTask(taskId)
                    deletePartialArtifact(task)
                    return true
                }
                DownloadTaskStatus.COMPLETED,
                DownloadTaskStatus.CANCELED,
                -> {
                    tasks.remove(taskId)
                    database.deleteTask(taskId)
                    return true
                }
            }
        }
    }

    fun removeTask(taskId: String): Boolean {
        synchronized(lock) {
            val task = tasks[taskId] ?: return false
            val wasCompleted = task.status == DownloadTaskStatus.COMPLETED
            removeFromQueue(taskId)
            runningTasks[taskId]?.control?.cancel()
            if (!wasCompleted) {
                updateTaskStatus(
                    task = task,
                    status = DownloadTaskStatus.CANCELED,
                    errorMessage = null,
                )
            }
            tasks.remove(taskId)
            database.deleteTask(taskId)
            if (!wasCompleted) {
                deletePartialArtifact(task)
            }
            return true
        }
    }

    fun getTask(taskId: String): DownloadTask? {
        return synchronized(lock) {
            tasks[taskId]?.copy()
        }
    }

    fun getAllTasks(): List<DownloadTask> {
        return synchronized(lock) {
            tasks.values
                .sortedBy { it.createdAt }
                .map { it.copy() }
        }
    }

    fun areNotificationsEnabled(): Boolean {
        return notificationManager.areNotificationsEnabled()
    }

    fun openNotificationSettings() {
        notificationManager.openNotificationSettings()
    }

    fun clearNotifications() {
        notificationManager.clearAllNotifications()
    }

    fun cancelNotification(taskId: String) {
        notificationManager.cancelNotification(taskId)
    }

    fun publishCompletedNotification(taskId: String, title: String, filePath: String?) {
        notificationManager.publishCompleted(taskId, title, filePath)
    }

    fun refreshNotifications() {
        val snapshot = synchronized(lock) {
            tasks.values.map { it.copy() }
        }
        notificationManager.refresh(snapshot)
    }

    fun shutdown() {
        try {
            runningTasks.values.forEach {
                it.control.cancel()
            }
        } catch (_: Exception) {
        }

        dispatcherExecutor.shutdownNow()
        workerExecutor.shutdownNow()
        progressFlushExecutor.shutdownNow()
        notificationManager.shutdown()
    }

    private fun restoreTasksFromDb() {
        val storedTasks = database.getAllTasks()
        synchronized(lock) {
            for (task in storedTasks) {
                val restored = when (task.status) {
                    DownloadTaskStatus.DOWNLOADING,
                    DownloadTaskStatus.PREPARING,
                    DownloadTaskStatus.PENDING,
                    -> task.copy(
                        status = DownloadTaskStatus.PAUSED,
                        errorMessage = "interrupted",
                        updatedAt = System.currentTimeMillis(),
                    )
                    else -> task
                }

                tasks[restored.taskId] = restored
                if (restored !== task) {
                    database.upsertTask(restored)
                }
                if (restored.status == DownloadTaskStatus.PENDING) {
                    pendingQueue.offer(restored.taskId)
                }
            }
        }
        dispatchAsync()
    }

    private fun dispatchAsync() {
        dispatcherExecutor.execute {
            dispatchLoop()
        }
    }

    private fun dispatchLoop() {
        while (true) {
            val nextTask: DownloadTask? = synchronized(lock) {
                if (runningTasks.size >= maxConcurrency) {
                    return@synchronized null
                }

                var taskId: String? = null
                while (true) {
                    val candidate = pendingQueue.poll() ?: break
                    val task = tasks[candidate]
                    if (task != null && task.status == DownloadTaskStatus.PENDING) {
                        taskId = candidate
                        break
                    }
                }

                taskId?.let { tasks[it] }
            }

            if (nextTask == null) {
                maybeEmitQueueDrained()
                return
            }

            startTask(nextTask)
        }
    }

    private fun startTask(task: DownloadTask) {
        synchronized(lock) {
            updateTaskStatus(task, DownloadTaskStatus.PREPARING, null)
            updateTaskStatus(task, DownloadTaskStatus.DOWNLOADING, null)
        }

        val control = DownloadExecutor.ExecutionControl()
        // 必须先登记再提交：若任务瞬间失败，runTask 末尾的 remove 可能先于
        // put 执行，留下的死条目会永久占用并发槽位
        val futureTask = FutureTask(Callable { runTask(task.taskId, control) })
        runningTasks[task.taskId] = RunningTask(control = control, future = futureTask)
        workerExecutor.execute(futureTask)
    }

    private fun runTask(taskId: String, control: DownloadExecutor.ExecutionControl) {
        val task = synchronized(lock) { tasks[taskId] } ?: return

        val result = downloadExecutor.execute(
            task = task,
            control = control,
        ) { downloaded, total ->
            // 共享的 DownloadTask 字段写入必须持锁，与 flushProgressBatch 的读写互斥
            synchronized(lock) {
                val currentTask = tasks[taskId] ?: return@execute
                currentTask.downloadedBytes = downloaded
                currentTask.totalBytes = total
                currentTask.updatedAt = System.currentTimeMillis()
            }
            progressCache[taskId] = ProgressSnapshot(
                taskId = taskId,
                downloaded = downloaded,
                total = total,
                percent = calculatePercent(downloaded, total),
                progressText = buildProgressText(downloaded, total),
            )
        }

        synchronized(lock) {
            runningTasks.remove(taskId)
            progressCache.remove(taskId)
            val currentTask = tasks[taskId]
            if (currentTask == null) {
                // A JS-side remove can race with a worker that has not opened
                // its destination yet. Clean up again after the worker exits so
                // it cannot leave a newly-created zero-byte/partial artifact.
                deletePartialArtifact(task)
                return@synchronized
            }
            currentTask.downloadedBytes = result.downloadedBytes
            currentTask.totalBytes = result.totalBytes
            currentTask.updatedAt = System.currentTimeMillis()

            when (result.finalStatus) {
                DownloadTaskStatus.COMPLETED -> {
                    updateTaskStatus(currentTask, DownloadTaskStatus.COMPLETED, null)
                }
                DownloadTaskStatus.CANCELED -> {
                    updateTaskStatus(currentTask, DownloadTaskStatus.CANCELED, null)
                    tasks.remove(taskId)
                    database.deleteTask(taskId)
                    deletePartialArtifact(currentTask)
                }
                DownloadTaskStatus.PAUSED -> {
                    updateTaskStatus(currentTask, DownloadTaskStatus.PAUSED, null)
                }
                DownloadTaskStatus.ERROR -> {
                    updateTaskStatus(
                        currentTask,
                        DownloadTaskStatus.ERROR,
                        result.errorMessage ?: "unknown error",
                    )
                }
                else -> {
                    updateTaskStatus(currentTask, DownloadTaskStatus.ERROR, "unexpected state")
                }
            }
        }

        dispatchAsync()
    }

    private fun flushProgressBatch() {
        val pendingSnapshots = mutableListOf<ProgressSnapshot>()
        progressCache.forEach { (taskId, snapshot) ->
            if (progressCache.remove(taskId, snapshot)) {
                pendingSnapshots.add(snapshot)
            }
        }
        if (pendingSnapshots.isEmpty()) return

        val activeSnapshots = mutableListOf<ProgressSnapshot>()
        val taskSnapshotById = mutableMapOf<String, DownloadTask>()
        synchronized(lock) {
            pendingSnapshots.forEach { snapshot ->
                val task = tasks[snapshot.taskId] ?: return@forEach
                if (
                    task.status != DownloadTaskStatus.PREPARING &&
                    task.status != DownloadTaskStatus.DOWNLOADING
                ) {
                    return@forEach
                }
                task.downloadedBytes = snapshot.downloaded
                task.totalBytes = snapshot.total
                task.updatedAt = System.currentTimeMillis()
                // 进度不落盘：批量下载时每 500ms 逐任务写 SQLite 开销过大，
                // 且重启恢复时进行中任务一律标记为中断，持久化进度没有意义。
                // 状态变化由 updateTaskStatus 负责落盘。
                activeSnapshots.add(snapshot)
                taskSnapshotById[snapshot.taskId] = task.copy()
            }
        }
        if (activeSnapshots.isEmpty()) return
        listener.onProgressBatch(activeSnapshots)
        notificationManager.onProgressBatch(activeSnapshots, taskSnapshotById)
    }

    private fun maybeEmitQueueDrained() {
        synchronized(lock) {
            val hasPending = pendingQueue.isNotEmpty()
            val hasRunning = runningTasks.isNotEmpty()
            if (!hasPending && !hasRunning) {
                listener.onQueueDrained()
                notificationManager.onQueueDrained()
            }
        }
    }

    private fun updateTaskStatus(
        task: DownloadTask,
        status: DownloadTaskStatus,
        errorMessage: String?,
    ) {
        task.status = status
        task.errorMessage = errorMessage
        task.updatedAt = System.currentTimeMillis()
        database.upsertTask(task)
        emitStatusChanged(task)
    }

    private fun emitStatusChanged(task: DownloadTask) {
        val snapshot = task.copy()
        listener.onTaskStatusChanged(snapshot)
        notificationManager.onTaskStatusChanged(snapshot)
    }

    private fun removeFromQueue(taskId: String) {
        if (pendingQueue.isEmpty()) return
        val retained = mutableListOf<String>()
        while (true) {
            val item = pendingQueue.poll() ?: break
            if (item != taskId) {
                retained.add(item)
            }
        }
        retained.forEach { pendingQueue.offer(it) }
    }

    private fun deletePartialArtifact(task: DownloadTask) {
        try {
            val file = File(task.destinationPath)
            if (file.exists()) {
                file.delete()
            }
        } catch (_: Exception) {
        }
    }

    private fun calculatePercent(downloaded: Long, total: Long): Int {
        if (downloaded <= 0L || total <= 0L) return 0
        return ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
    }

    private fun buildProgressText(downloaded: Long, total: Long): String {
        return when {
            downloaded <= 0L -> "正在准备下载..."
            total > 0L -> "${formatFileSize(downloaded)} / ${formatFileSize(total)}"
            else -> "已下载 ${formatFileSize(downloaded)}"
        }
    }

    private fun formatFileSize(bytes: Long): String {
        return when {
            bytes <= 0L -> "0B"
            bytes < 1024L -> "${bytes}B"
            bytes < 1024L * 1024L -> String.format("%.1fKB", bytes / 1024.0)
            bytes < 1024L * 1024L * 1024L -> String.format("%.1fMB", bytes / (1024.0 * 1024.0))
            else -> String.format("%.1fGB", bytes / (1024.0 * 1024.0 * 1024.0))
        }
    }
}
