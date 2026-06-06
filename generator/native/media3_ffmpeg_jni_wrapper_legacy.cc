/*
 * MusicFree Media3 FFmpeg JNI wrapper for the legacy ExoPlayer FFmpeg 4 base.
 *
 * The local exoplayer-ffmpeg-extension-v2.19.1 AAR was built from the
 * CTZZG/jellyfin-androidx-media dsf branch with DSD decoders enabled. This
 * wrapper exposes the Media3 JNI entry points while loading that legacy shared
 * object as libffmJNIb.so.
 */
#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>
#include <stdlib.h>
#include <string.h>

extern "C" {
#ifdef __cplusplus
#define __STDC_CONSTANT_MACROS
#ifdef _STDINT_H
#undef _STDINT_H
#endif
#include <stdint.h>
#endif
#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libavutil/mem.h>
#include <libavutil/opt.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
}

#define LOG_TAG "musicfree_ffmpeg_legacy_jni"
#define LOGE(...) \
  ((void)__android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__))
#define LOGD(...) \
  ((void)__android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__))

#define LIBRARY_FUNC(RETURN_TYPE, NAME, ...)                               \
  extern "C" {                                                             \
  JNIEXPORT RETURN_TYPE                                                    \
  Java_androidx_media3_decoder_ffmpeg_FfmpegLibrary_##NAME(JNIEnv* env,    \
                                                           jobject thiz,   \
                                                           ##__VA_ARGS__); \
  }                                                                        \
  JNIEXPORT RETURN_TYPE                                                    \
  Java_androidx_media3_decoder_ffmpeg_FfmpegLibrary_##NAME(                \
      JNIEnv* env, jobject thiz, ##__VA_ARGS__)

#define AUDIO_DECODER_FUNC(RETURN_TYPE, NAME, ...)               \
  extern "C" {                                                   \
  JNIEXPORT RETURN_TYPE                                          \
  Java_androidx_media3_decoder_ffmpeg_FfmpegAudioDecoder_##NAME( \
      JNIEnv* env, jobject thiz, ##__VA_ARGS__);                 \
  }                                                              \
  JNIEXPORT RETURN_TYPE                                          \
  Java_androidx_media3_decoder_ffmpeg_FfmpegAudioDecoder_##NAME( \
      JNIEnv* env, jobject thiz, ##__VA_ARGS__)

namespace {

static const int kAudioDecoderErrorInvalidData = -1;
static const int kAudioDecoderErrorOther = -2;
static const int kErrorStringBufferLength = 256;
static const int kTargetSampleRate = 48000;
static const int kWaveFormatExMinSize = 18;

static const AVSampleFormat kOutputFormatPcm16 = AV_SAMPLE_FMT_S16;
static const AVSampleFormat kOutputFormatFloat = AV_SAMPLE_FMT_FLT;

using AvcodecRegisterAll = void (*)();
using AvcodecFindDecoderByName = AVCodec* (*)(const char*);
using AvcodecAllocContext3 = AVCodecContext* (*)(const AVCodec*);
using AvcodecOpen2 = int (*)(AVCodecContext*, const AVCodec*, AVDictionary**);
using AvcodecSendPacket = int (*)(AVCodecContext*, const AVPacket*);
using AvcodecReceiveFrame = int (*)(AVCodecContext*, AVFrame*);
using AvcodecFlushBuffers = void (*)(AVCodecContext*);
using AvcodecFreeContext = void (*)(AVCodecContext**);
using AvFrameAlloc = AVFrame* (*)();
using AvFrameFree = void (*)(AVFrame**);
using AvGetBytesPerSample = int (*)(AVSampleFormat);
using AvGetDefaultChannelLayout = int64_t (*)(int);
using AvInitPacket = void (*)(AVPacket*);
using AvMalloc = void* (*)(size_t);
using AvOptSetInt = int (*)(void*, const char*, int64_t, int);
using AvStrerror = int (*)(int, char*, size_t);
using SwrAlloc = SwrContext* (*)();
using SwrConvert = int (*)(SwrContext*, uint8_t**, int, const uint8_t**, int);
using SwrFree = void (*)(SwrContext**);
using SwrGetOutSamples = int (*)(SwrContext*, int);
using SwrInit = int (*)(SwrContext*);

struct FfmpegSymbols {
  AvcodecRegisterAll avcodec_register_all;
  AvcodecFindDecoderByName avcodec_find_decoder_by_name;
  AvcodecAllocContext3 avcodec_alloc_context3;
  AvcodecOpen2 avcodec_open2;
  AvcodecSendPacket avcodec_send_packet;
  AvcodecReceiveFrame avcodec_receive_frame;
  AvcodecFlushBuffers avcodec_flush_buffers;
  AvcodecFreeContext avcodec_free_context;
  AvFrameAlloc av_frame_alloc;
  AvFrameFree av_frame_free;
  AvGetBytesPerSample av_get_bytes_per_sample;
  AvGetDefaultChannelLayout av_get_default_channel_layout;
  AvInitPacket av_init_packet;
  AvMalloc av_malloc;
  AvOptSetInt av_opt_set_int;
  AvStrerror av_strerror;
  SwrAlloc swr_alloc;
  SwrConvert swr_convert;
  SwrFree swr_free;
  SwrGetOutSamples swr_get_out_samples;
  SwrInit swr_init;
};

struct DecoderContext {
  AVCodecContext* codecContext;
  const AVCodec* codec;
  jboolean outputFloat;
  int rawSampleRate;
  int rawChannelCount;
  int outputSampleRate;
};

struct GrowOutputBufferCallback {
  uint8_t* operator()(int requiredSize) const;

  JNIEnv* env;
  jobject thiz;
  jobject decoderOutputBuffer;
};

void* gBaseLibrary = nullptr;
FfmpegSymbols gSymbols = {};
jmethodID gGrowOutputBufferMethod = nullptr;
bool gCodecsRegistered = false;

template <typename T>
bool loadSymbol(T* target, const char* name) {
  *target = reinterpret_cast<T>(dlsym(gBaseLibrary, name));
  if (*target == nullptr) {
    LOGE("Missing FFmpeg symbol %s: %s", name, dlerror());
    return false;
  }
  return true;
}

bool loadBaseLibrary() {
  if (gBaseLibrary != nullptr) {
    return true;
  }
  gBaseLibrary = dlopen("libffmJNIb.so", RTLD_NOW | RTLD_LOCAL);
  if (gBaseLibrary == nullptr) {
    LOGE("dlopen libffmJNIb.so failed: %s", dlerror());
    return false;
  }

  bool ok =
      loadSymbol(&gSymbols.avcodec_register_all, "avcodec_register_all") &&
      loadSymbol(&gSymbols.avcodec_find_decoder_by_name,
                 "avcodec_find_decoder_by_name") &&
      loadSymbol(&gSymbols.avcodec_alloc_context3,
                 "avcodec_alloc_context3") &&
      loadSymbol(&gSymbols.avcodec_open2, "avcodec_open2") &&
      loadSymbol(&gSymbols.avcodec_send_packet, "avcodec_send_packet") &&
      loadSymbol(&gSymbols.avcodec_receive_frame, "avcodec_receive_frame") &&
      loadSymbol(&gSymbols.avcodec_flush_buffers, "avcodec_flush_buffers") &&
      loadSymbol(&gSymbols.avcodec_free_context, "avcodec_free_context") &&
      loadSymbol(&gSymbols.av_frame_alloc, "av_frame_alloc") &&
      loadSymbol(&gSymbols.av_frame_free, "av_frame_free") &&
      loadSymbol(&gSymbols.av_get_bytes_per_sample,
                 "av_get_bytes_per_sample") &&
      loadSymbol(&gSymbols.av_get_default_channel_layout,
                 "av_get_default_channel_layout") &&
      loadSymbol(&gSymbols.av_init_packet, "av_init_packet") &&
      loadSymbol(&gSymbols.av_malloc, "av_malloc") &&
      loadSymbol(&gSymbols.av_opt_set_int, "av_opt_set_int") &&
      loadSymbol(&gSymbols.av_strerror, "av_strerror") &&
      loadSymbol(&gSymbols.swr_alloc, "swr_alloc") &&
      loadSymbol(&gSymbols.swr_convert, "swr_convert") &&
      loadSymbol(&gSymbols.swr_free, "swr_free") &&
      loadSymbol(&gSymbols.swr_get_out_samples, "swr_get_out_samples") &&
      loadSymbol(&gSymbols.swr_init, "swr_init");

  if (ok && !gCodecsRegistered) {
    gSymbols.avcodec_register_all();
    gCodecsRegistered = true;
  }
  return ok;
}

int effectiveOutputSampleRate(int inputSampleRate) {
  if (inputSampleRate <= 0) {
    return inputSampleRate;
  }
  return inputSampleRate > kTargetSampleRate ? kTargetSampleRate
                                             : inputSampleRate;
}

bool isRawParamCodec(AVCodecID codecId) {
  return codecId == AV_CODEC_ID_PCM_MULAW ||
         codecId == AV_CODEC_ID_PCM_ALAW ||
         codecId == AV_CODEC_ID_DSD_LSBF ||
         codecId == AV_CODEC_ID_DSD_MSBF ||
         codecId == AV_CODEC_ID_DSD_LSBF_PLANAR ||
         codecId == AV_CODEC_ID_DSD_MSBF_PLANAR;
}

bool isWaveFormatExCodec(AVCodecID codecId) {
  return codecId == AV_CODEC_ID_WMAV1 ||
         codecId == AV_CODEC_ID_WMAV2 ||
         codecId == AV_CODEC_ID_WMAPRO ||
         codecId == AV_CODEC_ID_WMALOSSLESS ||
         codecId == AV_CODEC_ID_WMAVOICE;
}

uint16_t readLittleEndian16(const uint8_t* data, int offset) {
  return static_cast<uint16_t>(data[offset]) |
         (static_cast<uint16_t>(data[offset + 1]) << 8);
}

uint32_t readLittleEndian32(const uint8_t* data, int offset) {
  return static_cast<uint32_t>(data[offset]) |
         (static_cast<uint32_t>(data[offset + 1]) << 8) |
         (static_cast<uint32_t>(data[offset + 2]) << 16) |
         (static_cast<uint32_t>(data[offset + 3]) << 24);
}

bool copyExtraData(JNIEnv* env, AVCodecContext* context, jbyteArray extraData,
                   int offset, int size) {
  if (size <= 0) {
    return true;
  }
  context->extradata_size = size;
  context->extradata = reinterpret_cast<uint8_t*>(
      gSymbols.av_malloc(size + AV_INPUT_BUFFER_PADDING_SIZE));
  if (context->extradata == nullptr) {
    LOGE("Failed to allocate extradata.");
    return false;
  }
  env->GetByteArrayRegion(extraData, offset, size,
                          reinterpret_cast<jbyte*>(context->extradata));
  memset(context->extradata + size, 0, AV_INPUT_BUFFER_PADDING_SIZE);
  return true;
}

bool applyWaveFormatEx(JNIEnv* env, AVCodecContext* context,
                       jbyteArray extraData) {
  if (!isWaveFormatExCodec(context->codec_id) || extraData == nullptr) {
    return false;
  }

  jsize size = env->GetArrayLength(extraData);
  if (size < kWaveFormatExMinSize) {
    return false;
  }

  uint8_t header[kWaveFormatExMinSize] = {};
  env->GetByteArrayRegion(extraData, 0, kWaveFormatExMinSize,
                          reinterpret_cast<jbyte*>(header));
  int channelCount = readLittleEndian16(header, 2);
  int sampleRate = static_cast<int>(readLittleEndian32(header, 4));
  int averageBytesPerSecond =
      static_cast<int>(readLittleEndian32(header, 8));
  int blockAlign = readLittleEndian16(header, 12);
  int bitsPerSample = readLittleEndian16(header, 14);
  int declaredExtraSize = readLittleEndian16(header, 16);
  int availableExtraSize = size - kWaveFormatExMinSize;
  int codecExtraSize =
      declaredExtraSize < availableExtraSize ? declaredExtraSize
                                             : availableExtraSize;

  context->codec_tag = readLittleEndian16(header, 0);
  context->sample_rate = sampleRate;
  context->channels = channelCount;
  context->channel_layout =
      gSymbols.av_get_default_channel_layout(channelCount);
  context->bit_rate = static_cast<int64_t>(averageBytesPerSecond) * 8;
  context->block_align = blockAlign;
  context->bits_per_coded_sample = bitsPerSample;

  return copyExtraData(env, context, extraData, kWaveFormatExMinSize,
                       codecExtraSize);
}

void logError(const char* functionName, int errorNumber) {
  char* buffer = reinterpret_cast<char*>(
      malloc(kErrorStringBufferLength * sizeof(char)));
  if (buffer == nullptr) {
    LOGE("Error in %s: %d", functionName, errorNumber);
    return;
  }
  gSymbols.av_strerror(errorNumber, buffer, kErrorStringBufferLength);
  LOGE("Error in %s: %s", functionName, buffer);
  free(buffer);
}

int transformError(int errorNumber) {
  return errorNumber == AVERROR_INVALIDDATA ? kAudioDecoderErrorInvalidData
                                            : kAudioDecoderErrorOther;
}

void releaseContext(DecoderContext* context) {
  if (context == nullptr) {
    return;
  }
  if (context->codecContext != nullptr) {
    SwrContext* swrContext =
        static_cast<SwrContext*>(context->codecContext->opaque);
    if (swrContext != nullptr) {
      gSymbols.swr_free(&swrContext);
      context->codecContext->opaque = nullptr;
    }
    gSymbols.avcodec_free_context(&context->codecContext);
  }
  free(context);
}

AVCodecContext* createCodecContext(JNIEnv* env, const AVCodec* codec,
                                   jbyteArray extraData,
                                   jboolean outputFloat,
                                   jint rawSampleRate,
                                   jint rawChannelCount) {
  AVCodecContext* context = gSymbols.avcodec_alloc_context3(codec);
  if (context == nullptr) {
    LOGE("Failed to allocate context.");
    return nullptr;
  }

  context->request_sample_fmt =
      outputFloat ? kOutputFormatFloat : kOutputFormatPcm16;

  if (!applyWaveFormatEx(env, context, extraData) && extraData != nullptr) {
    jsize size = env->GetArrayLength(extraData);
    if (!copyExtraData(env, context, extraData, 0, size)) {
      gSymbols.avcodec_free_context(&context);
      return nullptr;
    }
  }

  if (isRawParamCodec(context->codec_id)) {
    context->sample_rate = rawSampleRate;
    context->channels = rawChannelCount;
    context->channel_layout =
        gSymbols.av_get_default_channel_layout(rawChannelCount);
  }

  context->err_recognition = AV_EF_IGNORE_ERR;
  int result = gSymbols.avcodec_open2(context, codec, nullptr);
  if (result < 0) {
    logError("avcodec_open2", result);
    gSymbols.avcodec_free_context(&context);
    return nullptr;
  }

  return context;
}

DecoderContext* createDecoderContext(JNIEnv* env, const AVCodec* codec,
                                     jbyteArray extraData,
                                     jboolean outputFloat,
                                     jint rawSampleRate,
                                     jint rawChannelCount) {
  AVCodecContext* codecContext = createCodecContext(
      env, codec, extraData, outputFloat, rawSampleRate, rawChannelCount);
  if (codecContext == nullptr) {
    return nullptr;
  }

  DecoderContext* context =
      static_cast<DecoderContext*>(calloc(1, sizeof(DecoderContext)));
  if (context == nullptr) {
    LOGE("Failed to allocate decoder context.");
    gSymbols.avcodec_free_context(&codecContext);
    return nullptr;
  }
  context->codecContext = codecContext;
  context->codec = codec;
  context->outputFloat = outputFloat;
  context->rawSampleRate = rawSampleRate;
  context->rawChannelCount = rawChannelCount;
  context->outputSampleRate =
      effectiveOutputSampleRate(codecContext->sample_rate);
  return context;
}

const AVCodec* getCodecByName(JNIEnv* env, jstring codecName) {
  if (codecName == nullptr || !loadBaseLibrary()) {
    return nullptr;
  }
  const char* codecNameChars = env->GetStringUTFChars(codecName, nullptr);
  const AVCodec* codec =
      gSymbols.avcodec_find_decoder_by_name(codecNameChars);
  env->ReleaseStringUTFChars(codecName, codecNameChars);
  return codec;
}

int decodePacket(DecoderContext* context, AVPacket* packet,
                 uint8_t* outputBuffer, int outputSize,
                 GrowOutputBufferCallback growBuffer) {
  AVCodecContext* codecContext = context->codecContext;
  int result = gSymbols.avcodec_send_packet(codecContext, packet);
  if (result != 0) {
    logError("avcodec_send_packet", result);
    return transformError(result);
  }

  int outSize = 0;
  while (true) {
    AVFrame* frame = gSymbols.av_frame_alloc();
    if (frame == nullptr) {
      LOGE("Failed to allocate output frame.");
      return kAudioDecoderErrorInvalidData;
    }

    result = gSymbols.avcodec_receive_frame(codecContext, frame);
    if (result != 0) {
      gSymbols.av_frame_free(&frame);
      if (result == AVERROR(EAGAIN)) {
        break;
      }
      logError("avcodec_receive_frame", result);
      return transformError(result);
    }

    AVSampleFormat sampleFormat = codecContext->sample_fmt;
    int channelCount = codecContext->channels;
    int64_t channelLayout = codecContext->channel_layout;
    if (channelLayout == 0 && channelCount > 0) {
      channelLayout = gSymbols.av_get_default_channel_layout(channelCount);
    }
    int inputSampleRate = codecContext->sample_rate;
    int outputSampleRate = effectiveOutputSampleRate(inputSampleRate);
    context->outputSampleRate = outputSampleRate;

    SwrContext* resampleContext =
        static_cast<SwrContext*>(codecContext->opaque);
    if (resampleContext == nullptr) {
      resampleContext = gSymbols.swr_alloc();
      if (resampleContext == nullptr) {
        LOGE("Failed to allocate resample context.");
        gSymbols.av_frame_free(&frame);
        return kAudioDecoderErrorOther;
      }
      gSymbols.av_opt_set_int(resampleContext, "in_channel_layout",
                              channelLayout, 0);
      gSymbols.av_opt_set_int(resampleContext, "out_channel_layout",
                              channelLayout, 0);
      gSymbols.av_opt_set_int(resampleContext, "in_sample_rate",
                              inputSampleRate, 0);
      gSymbols.av_opt_set_int(resampleContext, "out_sample_rate",
                              outputSampleRate, 0);
      gSymbols.av_opt_set_int(resampleContext, "in_sample_fmt", sampleFormat,
                              0);
      gSymbols.av_opt_set_int(resampleContext, "out_sample_fmt",
                              codecContext->request_sample_fmt, 0);
      result = gSymbols.swr_init(resampleContext);
      if (result < 0) {
        logError("swr_init", result);
        gSymbols.swr_free(&resampleContext);
        gSymbols.av_frame_free(&frame);
        return transformError(result);
      }
      codecContext->opaque = resampleContext;
    }

    int outSampleSize =
        gSymbols.av_get_bytes_per_sample(codecContext->request_sample_fmt);
    int outSamples =
        gSymbols.swr_get_out_samples(resampleContext, frame->nb_samples);
    int bufferOutSize = outSampleSize * channelCount * outSamples;
    if (outSize + bufferOutSize > outputSize) {
      outputSize = outSize + bufferOutSize;
      outputBuffer = growBuffer(outputSize);
      if (outputBuffer == nullptr) {
        LOGE("Failed to reallocate output buffer.");
        gSymbols.av_frame_free(&frame);
        return kAudioDecoderErrorOther;
      }
      outputBuffer += outSize;
    }

    int convertedSamples = gSymbols.swr_convert(
        resampleContext, &outputBuffer, outSamples,
        const_cast<const uint8_t**>(frame->data), frame->nb_samples);
    gSymbols.av_frame_free(&frame);
    if (convertedSamples < 0) {
      logError("swr_convert", convertedSamples);
      return kAudioDecoderErrorInvalidData;
    }

    int writtenBytes = convertedSamples * outSampleSize * channelCount;
    outputBuffer += writtenBytes;
    outSize += writtenBytes;
  }

  return outSize;
}

uint8_t* GrowOutputBufferCallback::operator()(int requiredSize) const {
  jobject newBuffer = env->CallObjectMethod(
      thiz, gGrowOutputBufferMethod, decoderOutputBuffer, requiredSize);
  return reinterpret_cast<uint8_t*>(env->GetDirectBufferAddress(newBuffer));
}

}  // namespace

jint JNI_OnLoad(JavaVM* vm, void* reserved) {
  JNIEnv* env;
  if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    LOGE("JNI_OnLoad: GetEnv failed");
    return -1;
  }
  if (!loadBaseLibrary()) {
    return -1;
  }
  jclass clazz =
      env->FindClass("androidx/media3/decoder/ffmpeg/FfmpegAudioDecoder");
  if (clazz == nullptr) {
    LOGE("JNI_OnLoad: FindClass failed");
    return -1;
  }
  gGrowOutputBufferMethod =
      env->GetMethodID(clazz, "growOutputBuffer",
                       "(Landroidx/media3/decoder/"
                       "SimpleDecoderOutputBuffer;I)Ljava/nio/ByteBuffer;");
  if (gGrowOutputBufferMethod == nullptr) {
    LOGE("JNI_OnLoad: GetMethodID failed");
    return -1;
  }
  return JNI_VERSION_1_6;
}

LIBRARY_FUNC(jstring, ffmpegGetVersion) {
  return env->NewStringUTF(LIBAVCODEC_IDENT);
}

LIBRARY_FUNC(jint, ffmpegGetInputBufferPaddingSize) {
  return static_cast<jint>(AV_INPUT_BUFFER_PADDING_SIZE);
}

LIBRARY_FUNC(jboolean, ffmpegHasDecoder, jstring codecName) {
  return getCodecByName(env, codecName) != nullptr;
}

AUDIO_DECODER_FUNC(jlong, ffmpegInitialize, jstring codecName,
                   jbyteArray extraData, jboolean outputFloat,
                   jint rawSampleRate, jint rawChannelCount) {
  const AVCodec* codec = getCodecByName(env, codecName);
  if (codec == nullptr) {
    LOGE("Codec not found.");
    return 0L;
  }
  DecoderContext* context = createDecoderContext(
      env, codec, extraData, outputFloat, rawSampleRate, rawChannelCount);
  return reinterpret_cast<jlong>(context);
}

AUDIO_DECODER_FUNC(jint, ffmpegDecode, jlong context, jobject inputData,
                   jint inputSize, jobject decoderOutputBuffer,
                   jobject outputData, jint outputSize) {
  if (context == 0) {
    LOGE("Context must be non-NULL.");
    return -1;
  }
  if (inputData == nullptr || decoderOutputBuffer == nullptr ||
      outputData == nullptr) {
    LOGE("Input and output buffers must be non-NULL.");
    return -1;
  }
  if (inputSize < 0) {
    LOGE("Invalid input size: %d.", inputSize);
    return -1;
  }

  uint8_t* inputBuffer =
      reinterpret_cast<uint8_t*>(env->GetDirectBufferAddress(inputData));
  uint8_t* outputBuffer =
      reinterpret_cast<uint8_t*>(env->GetDirectBufferAddress(outputData));
  if (inputBuffer == nullptr || outputBuffer == nullptr) {
    LOGE("Input and output buffers must be direct byte buffers (input=%d, output=%d).",
         inputBuffer != nullptr, outputBuffer != nullptr);
    return -1;
  }

  AVPacket packet;
  gSymbols.av_init_packet(&packet);
  packet.data = inputBuffer;
  packet.size = inputSize;

  return decodePacket(
      reinterpret_cast<DecoderContext*>(context), &packet, outputBuffer,
      outputSize,
      GrowOutputBufferCallback{env, thiz, decoderOutputBuffer});
}

AUDIO_DECODER_FUNC(jint, ffmpegGetChannelCount, jlong context) {
  if (context == 0) {
    LOGE("Context must be non-NULL.");
    return -1;
  }
  AVCodecContext* codecContext =
      reinterpret_cast<DecoderContext*>(context)->codecContext;
  return codecContext->channels;
}

AUDIO_DECODER_FUNC(jint, ffmpegGetSampleRate, jlong context) {
  if (context == 0) {
    LOGE("Context must be non-NULL.");
    return -1;
  }
  DecoderContext* decoderContext = reinterpret_cast<DecoderContext*>(context);
  return decoderContext->outputSampleRate > 0
             ? decoderContext->outputSampleRate
             : effectiveOutputSampleRate(
                   decoderContext->codecContext->sample_rate);
}

AUDIO_DECODER_FUNC(jlong, ffmpegReset, jlong jContext, jbyteArray extraData) {
  if (jContext == 0) {
    LOGE("Tried to reset without a context.");
    return 0L;
  }

  DecoderContext* context = reinterpret_cast<DecoderContext*>(jContext);
  gSymbols.avcodec_flush_buffers(context->codecContext);
  return jContext;
}

AUDIO_DECODER_FUNC(void, ffmpegRelease, jlong context) {
  if (context != 0) {
    releaseContext(reinterpret_cast<DecoderContext*>(context));
  }
}
