cmake_minimum_required(VERSION 3.22.1)

project(appmodules LANGUAGES CXX)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

add_library(
    musicfree-cenc
    SHARED
    cenc/cenc_jni.cpp
    cenc/aes.cpp
    cenc/cenc_decoder.cpp
    cenc/mp4.cpp
)

target_include_directories(musicfree-cenc PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(musicfree-cenc PRIVATE cxx_std_17)
target_compile_options(musicfree-cenc PRIVATE -fexceptions)

find_library(log-lib log)
target_link_libraries(musicfree-cenc ${log-lib})
