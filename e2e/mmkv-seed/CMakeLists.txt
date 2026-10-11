# 由 build.sh 调用：MMKV_SOURCE_DIR 是取下来的 Tencent/MMKV（固定在 v2.4.0）
cmake_minimum_required(VERSION 3.10.0)
project(mmkv_seed CXX)

add_subdirectory(${MMKV_SOURCE_DIR}/Core mmkv-core)

add_executable(mmkv-seed seed.cpp)
target_include_directories(mmkv-seed PRIVATE ${MMKV_SOURCE_DIR}/Core/include)
target_link_libraries(mmkv-seed core pthread)
set_target_properties(mmkv-seed PROPERTIES CXX_STANDARD 20 CXX_EXTENSIONS OFF)
