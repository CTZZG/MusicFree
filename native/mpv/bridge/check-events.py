#!/usr/bin/env python3
"""Compile the patched real JNI event loop and command body against host boundaries."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('bridge_builder', HERE.parent/'rebuild-bridge.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

def function(source, signature):
    start = source.index(signature)
    at = source.index('{', start) + 1
    depth = 1
    while depth:
        if source[at] == '{': depth += 1
        if source[at] == '}': depth -= 1
        at += 1
    return source[start:at]

with tempfile.TemporaryDirectory(prefix='musicfree-bridge-') as directory:
    root = Path(directory)
    source = builder.prepare_sources(root/'source')/'libmpv/src/main/cpp'
    stubs = root/'stubs'
    (stubs/'android').mkdir(parents=True)
    (stubs/'android/log.h').write_text('''#pragma once
#define ANDROID_LOG_ERROR 6
#define ANDROID_LOG_VERBOSE 2
inline int __android_log_print(int, const char*, const char*, ...) { return 0; }
''')
    (stubs/'jni.h').write_text(r'''#pragma once
#include <string>
#include <vector>
using jint=int; using jlong=long long; using jobject=void*; using jclass=void*;
using jstring=const char*; using jobjectArray=std::vector<jstring>*; using jmethodID=int;
struct Call { int method; std::vector<long long> args; };
extern std::vector<Call> calls;
struct JNIEnv {
    bool failed=false; int released=0;
    jstring NewStringUTF(const char* s) {return s;}
    void DeleteLocalRef(jobject) {}
    void DeleteLocalRef(jstring) {}
    int GetArrayLength(jobjectArray a) {return a->size();}
    jobject GetObjectArrayElement(jobjectArray a,int n) {return const_cast<char*>(a->at(n));}
    const char* GetStringUTFChars(jstring s,void*) {return s;}
    void ReleaseStringUTFChars(jstring,const char*) {released++;}
    bool ExceptionCheck() {return failed;}
    template<class T> static long long scalar(T n) {return static_cast<long long>(n);}
    static long long scalar(const char*) {return 0;}
    template<class... A> void CallVoidMethod(jobject,jmethodID m,A... a) {calls.push_back({m,{scalar(a)...}});}
};
struct JavaVM { void DetachCurrentThread() {} };
''')
    command = function((source/'main.cpp').read_text(), 'static jlong run_command(')
    harness = r'''
#include <cassert>
#include <cstdio>
#include <cstring>
#include "globals.h"
#include "jni_utils.h"
std::vector<Call> calls;
JNIEnv environment;
jmethodID mpv_MPVLib_event=1, mpv_MPVLib_eventWithFile=2, mpv_MPVLib_eventEndFile=3;
jmethodID mpv_MPVLib_eventProperty_S=4, mpv_MPVLib_eventProperty_Sb=5, mpv_MPVLib_eventProperty_Sl=6;
jmethodID mpv_MPVLib_eventProperty_Sd=7, mpv_MPVLib_eventProperty_SS=8, mpv_MPVLib_logMessage_SiS=9;
bool acquire_jni_env(JavaVM*,JNIEnv** e) {*e=&environment; return true;}
void throw_java_exception(JNIEnv* e,const char*) {e->failed=true;}
static MPVInstance* running;
static std::vector<mpv_event> events;
static size_t cursor=0;
static int status=0, freed=0;
extern "C" mpv_event* mpv_wait_event(mpv_handle*,double) {
    static mpv_event empty={};
    if(cursor==events.size()) {running->event_thread_request_exit=true;return &empty;}
    return &events[cursor++];
}
static std::vector<std::string> last_cmd;
extern "C" const char* mpv_event_name(mpv_event_id) {return "file-event";}
extern "C" int mpv_command(mpv_handle*,const char** args) {
    last_cmd.clear();
    for (int i = 0; args && args[i]; ++i) last_cmd.emplace_back(args[i]);
    return status;
}
extern "C" const char* mpv_error_string(int) {return "error";}
extern "C" int mpv_command_ret(mpv_handle*,const char** args,mpv_node* output) {
    last_cmd.clear();
    for (int i = 0; args && args[i]; ++i) last_cmd.emplace_back(args[i]);
    static char key[]="playlist_entry_id";
    static char* keys[]={key};
    static mpv_node value={}; value.format=MPV_FORMAT_INT64; value.u.int64=9007199254740993LL;
    static mpv_node_list list={1,&value,keys};
    output->format=MPV_FORMAT_NODE_MAP; output->u.list=&list;
    return status;
}
extern "C" void mpv_free_node_contents(mpv_node*) {freed++;}
'''
    harness += '\n#include "'+str(source/'event.cpp')+'"\n'+command+'\n'
    harness += r'''
int main() {
    JavaVM vm; MPVInstance instance={}; running=&instance; instance.vm=&vm;
    instance.mpv=reinterpret_cast<mpv_handle*>(1);
    const mpv_end_file_reason reasons[]={MPV_END_FILE_REASON_EOF,MPV_END_FILE_REASON_STOP,
        MPV_END_FILE_REASON_QUIT,MPV_END_FILE_REASON_ERROR,MPV_END_FILE_REASON_REDIRECT};
    mpv_event_start_file starts[5]={}; mpv_event_end_file ends[5]={};
    for(int n=0;n<5;n++) {
        const int64_t id=9007199254740993LL+n;
        starts[n].playlist_entry_id=id;
        ends[n].playlist_entry_id=id; ends[n].reason=reasons[n]; ends[n].error=n==3?-13:0;
        ends[n].playlist_insert_id=n==4?1234:0; ends[n].playlist_insert_num_entries=n==4?2:0;
        events.push_back({MPV_EVENT_START_FILE,0,0,&starts[n]});
        events.push_back({MPV_EVENT_FILE_LOADED,0,0,nullptr});
        events.push_back({MPV_EVENT_PLAYBACK_RESTART,0,0,nullptr});
        events.push_back({MPV_EVENT_END_FILE,0,0,&ends[n]});
    }
    event_thread(&instance);
    assert(calls.size()==20);
    for(int n=0;n<5;n++) {
        const int64_t id=starts[n].playlist_entry_id;
        for(int x=0;x<3;x++) {
            const auto &call=calls[n*4+x]; assert(call.method==2 && call.args.size()==2);
            assert(call.args[0]==(x==0?MPV_EVENT_START_FILE:x==1?MPV_EVENT_FILE_LOADED:MPV_EVENT_PLAYBACK_RESTART));
            assert(call.args[1]==id);
        }
        const auto &call=calls[n*4+3]; assert(call.method==3 && call.args.size()==5);
        assert(call.args[0]==reasons[n] && call.args[1]==ends[n].error && call.args[2]==id);
        assert(call.args[3]==ends[n].playlist_insert_id && call.args[4]==ends[n].playlist_insert_num_entries);
    }
    calls.clear(); cursor=0; instance.event_thread_request_exit=false;
    mpv_MPVLib_eventWithFile=0; mpv_MPVLib_eventEndFile=0;
    event_thread(&instance);
    assert(calls.size()==20);
    for(const auto &call:calls) assert(call.method==mpv_MPVLib_event && call.args.size()==1);
    instance.event_thread_request_exit=false;
    std::vector<jstring> args={"loadfile","https://example.test/video.mp4","replace"};
    assert(run_command(&environment,reinterpret_cast<jlong>(&instance),&args,true)==9007199254740993LL);
    assert(!environment.failed && environment.released==3 && freed==1);
    status=-13;
    run_command(&environment,reinterpret_cast<jlong>(&instance),&args,true);
    assert(environment.failed && environment.released==6 && freed==2);
    environment.failed=false;
    run_command(&environment,reinterpret_cast<jlong>(&instance),&args,false);
    assert(environment.failed && environment.released==9 && freed==3);

    // Supplementary Unicode (JNI Modified UTF-8 CESU-8 surrogate pair -> 4-byte standard UTF-8)
    status=0; environment.failed=false;
    std::vector<jstring> unicode_args={
        "loadfile",
        "https://example.test/\xED\xA0\xBC\xED\xBE\xB5.mp3",
        "replace",
        "-1",
        "user-agent=%12%App \xED\xA0\xBC\xED\xBE\xB5 1.0"
    };
    assert(run_command(&environment,reinterpret_cast<jlong>(&instance),&unicode_args,true)==9007199254740993LL);
    assert(!environment.failed && environment.released==14 && freed==4);
    assert(last_cmd.size()==5);
    assert(last_cmd[1]=="https://example.test/\xF0\x9F\x8E\xB5.mp3");
    assert(last_cmd[4]=="user-agent=%12%App \xF0\x9F\x8E\xB5 1.0");

    // Embedded Modified-UTF-8 NUL (0xC0 0x80) is rejected cleanly
    last_cmd.clear();
    std::vector<jstring> embedded_nul={"loadfile","https://example.test/a\xC0\x80z.mp3","replace"};
    assert(run_command(&environment,reinterpret_cast<jlong>(&instance),&embedded_nul,true)==-1);
    assert(environment.failed && last_cmd.empty() && environment.released==16);
    puts("Bridge: lossless END/scoped events, legacy fallback, exact 64-bit ID, UTF-8 normalization, cleanup and error propagation passed");
}
'''
    (root/'test.cpp').write_text(harness)
    subprocess.run(['c++','-std=c++17','-pthread','-I'+str(stubs),'-I'+str(source),'-I'+str(HERE/'include'),str(root/'test.cpp'),'-o',str(root/'probe')],check=True)
    subprocess.run([str(root/'probe')],check=True)
