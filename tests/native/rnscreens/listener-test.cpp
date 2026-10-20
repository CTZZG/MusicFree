#include "shims.h"
#include <barrier>
#include <iostream>
#include <thread>

// Only test visibility changes. Compile NativeProxy.cpp itself without this macro.
#define private public
#include "NativeProxy.h"
#undef private

using namespace facebook;
using namespace facebook::react;
using rnscreens::NativeProxy;

void require(bool value, const char* message) {
  if (!value) throw std::runtime_error(message);
}
struct Fixture {
  std::shared_ptr<jni::JavaObject> java = std::make_shared<jni::JavaObject>();
  std::shared_ptr<UIManager> manager = std::make_shared<UIManager>();
  std::shared_ptr<JFabricUIManager> fabric = std::make_shared<JFabricUIManager>(manager);
  std::unique_ptr<NativeProxy> proxy = std::make_unique<NativeProxy>(java);
  auto listeners() const { return manager->registry.tree.coordinator->listeners(); }
  void install() { proxy->nativeAddMutationsListener(fabric); }
  void deliver() const {
    ShadowViewMutationList mutations{{ShadowViewMutation::Type::Remove, {"RNSScreen", 7}},
                                     {ShadowViewMutation::Type::Remove, {"RCTView", 8}}};
    for (auto& listener : listeners()) {
      auto transaction = listener->pullTransaction(4, 12, {}, mutations);
      require(transaction && transaction->mutations.size() == 2 && transaction->number == 12,
              "screen removal changed the mounting transaction");
    }
  }
};

void concurrentInstall(int rounds) {
  for (int i = 0; i < rounds; ++i) {
    Fixture f;
    std::barrier gate(3);
    auto install = [&] { gate.arrive_and_wait(); f.install(); };
    std::thread module(install), ui(install);
    gate.arrive_and_wait(); module.join(); ui.join();
    require(f.listeners().size() == 1, "concurrent install registered duplicate delegates");
    f.deliver();
    require(f.java->calls == 1, "concurrent install delivered more than one notification");
    f.proxy->invalidateNative();
  }
  std::cout << "ok concurrent module/UI installs, " << rounds << " rounds\n";
}

int main(int argc, char**) {
  try {
    // TSAN mode exercises the exact production lazy-init/registration path only.
    if (argc > 1) { concurrentInstall(100); return 0; }
    {
      Fixture f; f.proxy->invalidateNative(); f.fabric->accessible = false; f.install();
      require(f.listeners().empty(), "a queued host resume reinstalled an invalidated proxy");
      std::cout << "ok queued resume after invalidation is ignored\n";
    }
    concurrentInstall(100);
    {
      Fixture f; f.install(); f.deliver(); f.proxy->invalidateNative(); f.deliver();
      require(f.java->calls == 1, "invalidation kept a live removal callback");
      std::cout << "ok invalidation disarms notification and preserves transactions\n";
    }
    {
      Fixture oldHost, newHost; oldHost.install(); newHost.install();
      oldHost.proxy->invalidateNative(); newHost.deliver();
      require(newHost.java->calls == 1 && oldHost.java->calls == 0,
              "an old host's teardown cleared or stole the new host's callback");
      newHost.proxy->invalidateNative();
      std::cout << "ok stale host teardown preserves the newer callback\n";
    }
    {
      Fixture f; f.install(); f.java->onNotify = [&](int) { f.proxy->invalidateNative(); };
      f.deliver(); f.deliver();
      require(f.java->calls == 1, "reentrant invalidation left the callback armed");
      std::cout << "ok callback may invalidate without holding the listener mutex\n";
    }
    {
      Fixture f; f.install(); auto listeners = f.listeners();
      std::weak_ptr<jni::JavaObject> reference = f.java;
      f.proxy->invalidateNative(); f.proxy.reset(); f.java.reset();
      require(reference.expired(), "orphaned delegate retained the Java proxy");
      for (auto& listener : listeners) require(listener->pullTransaction(1, 1, {}, {}).has_value(),
                                             "orphaned delegate cannot pass through a transaction");
      std::cout << "ok promoted delegate can outlive its owner safely\n";
    }
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n'; return 1;
  }
}
