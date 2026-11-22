#!/usr/bin/env python3
"""Exercise the real pinned Android reconfig function at fake EGL/window boundaries.

This proves target/context ownership and error paths, not Android pixels. Device
captures must separately reject the previously cropped or black paused picture.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
PREFIX = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
typedef int EGLDisplay;
typedef int EGLSurface;
typedef int EGLContext;
typedef int EGLConfig;
struct window { int w, h; };
typedef struct window ANativeWindow;
typedef ANativeWindow *EGLNativeWindowType;
#define EGL_NO_SURFACE 0
#define EGL_NO_CONTEXT 0
struct vo { int dwidth, dheight; };
struct priv { EGLDisplay egl_display; EGLSurface egl_surface;
              EGLContext egl_context; EGLConfig egl_config;
              int surface_width, surface_height; };
struct ra_ctx { struct priv *priv; struct vo *vo; void *swapchain; };
static ANativeWindow window;
static int wanted_w, wanted_h, target_w, target_h, current_context;
static int fail_step, makes, destroys, creates, wraps, order, geometry_order, create_order;
static bool valid_size, has_window;
static bool vo_android_surface_size(struct vo *vo, int *w, int *h) {
    *w=wanted_w; *h=wanted_h; return valid_size;
}
static ANativeWindow *vo_android_native_window(struct vo *vo) { return has_window ? &window : NULL; }
static int ANativeWindow_getFormat(ANativeWindow *w) { assert(w==&window); return 1; }
static int ANativeWindow_setBuffersGeometry(ANativeWindow *p, int w, int h, int fmt) {
    geometry_order=++order;
    if (fail_step==1) return -1;
    p->w=w; p->h=h; return 0;
}
static bool eglMakeCurrent(EGLDisplay d, EGLSurface draw, EGLSurface read, EGLContext c) {
    makes++;
    if ((draw==0 && fail_step==2) || (draw!=0 && fail_step==5)) return false;
    assert(draw==read);
    current_context=c; return true;
}
static bool eglDestroySurface(EGLDisplay d, EGLSurface s) {
    destroys++; assert(s!=0); return fail_step!=3;
}
static EGLSurface eglCreateWindowSurface(EGLDisplay d, EGLConfig c, EGLNativeWindowType w, void *attrs) {
    creates++; create_order=++order; assert(c==11 && w==&window);
    if (fail_step==4) return 0;
    target_w=w->w; target_h=w->h; return 23;
}
static void ra_gl_ctx_resize(void *swapchain, int w, int h, int fb) {
    wraps++; assert(fb==0);
    // Geometry applies to the native window. It does not retroactively resize
    // an already acquired EGL back buffer; the window target must match it.
    assert(target_w==w && target_h==h && current_context==7);
}
'''
MAIN = r'''
int main(void) {
    for (int c=0; c<13; c++) {
        window=(ANativeWindow){996,560}; target_w=996; target_h=560;
        current_context=7; wanted_w=1342; wanted_h=754;
        fail_step=0; makes=destroys=creates=wraps=order=geometry_order=create_order=0;
        valid_size=has_window=true;
        struct priv p={.egl_display=3,.egl_surface=19,.egl_context=7,.egl_config=11,
                       .surface_width=996,.surface_height=560};
        struct vo vo={996,560}; struct ra_ctx ctx={&p,&vo,NULL};
        bool ok=true, resize=true;
        if(c==0) { wanted_w=996; wanted_h=560; resize=false; }
        if(c==2) { window.w=target_w=p.surface_width=1342; window.h=target_h=p.surface_height=754;
                   wanted_w=996; wanted_h=560; }
        if(c==3) wanted_h=560;
        if(c==4) { valid_size=false; ok=false; }
        if(c==5) { has_window=false; ok=false; }
        if(c>=6 && c<=10) { fail_step=c-5; ok=false; }
        if(c==11) p.surface_width=p.surface_height=0;
        if(c==12) wanted_w=996;
        assert(android_reconfig(&ctx)==ok);
        assert(p.egl_context==7);
        if(ok) {
            assert(wraps==1 && vo.dwidth==wanted_w && vo.dheight==wanted_h);
            assert(current_context==7 && target_w==wanted_w && target_h==wanted_h);
            assert(makes==(resize?2:0) && destroys==resize && creates==resize);
            if(resize) assert(geometry_order<create_order);
            // Repeated layout must not destroy or recreate a settled target.
            int old_makes=makes, old_destroys=destroys, old_creates=creates;
            assert(android_reconfig(&ctx));
            assert(makes==old_makes && destroys==old_destroys && creates==old_creates);
        } else {
            assert(wraps==0);
            if(c<=6) assert(makes==0 && destroys==0 && creates==0);
            if(c==7) assert(makes==1 && destroys==0 && creates==0);
            if(c==8) assert(makes==1 && destroys==1 && creates==0);
            if(c==9) assert(p.egl_surface==EGL_NO_SURFACE);
        }
    }
    puts("13 actual C resize/context/error cases passed");
}
'''


def function(source):
    start = source.index('static bool android_reconfig(')
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def main():
    meta = json.loads((HERE / 'sources.lock.json').read_text())
    original = (HERE / 'tests/mpv-0.41-context-android.c').read_bytes()
    assert hashlib.sha256(original).hexdigest() == meta['upstreamAndroidContextSha256']
    with tempfile.TemporaryDirectory(prefix='mpv-surface-resize-') as directory:
        root = Path(directory)
        target = root / 'video/out/opengl/context_android.c'
        target.parent.mkdir(parents=True)
        target.write_bytes(original)
        subprocess.run(['git', 'apply', str(HERE / 'android-surface-resize.patch')], cwd=root, check=True)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == meta['patchedAndroidContextSha256']
        fixed = function(target.read_text())
        variants = {
            'fixed': (fixed, True),
            'upstream-old-target': (function(original.decode()), False),
            'skip-window-rebind': (fixed.replace('if (w != p->surface_width || h != p->surface_height)', 'if (false)'), False),
            'lose-current-context': (fixed.replace('p->egl_context))', 'EGL_NO_CONTEXT))'), False),
        }
        for name, (body, should_pass) in variants.items():
            c = root / (name + '.c')
            binary = c.with_suffix('')
            c.write_text(PREFIX + body + MAIN)
            subprocess.run(['cc', '-std=c11', str(c), '-o', str(binary)], check=True)
            result = subprocess.run([str(binary)], text=True, capture_output=True)
            assert (result.returncode == 0) == should_pass, name + ': ' + result.stdout + result.stderr
            print(name + ': ' + ('passed' if should_pass else 'rejected') + ' — ' + (result.stdout + result.stderr).strip())


if __name__ == '__main__':
    main()
