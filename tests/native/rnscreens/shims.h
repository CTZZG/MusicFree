// Host-only framework boundary for compiling the actual screens C++ sources.
// JNI delivery is represented by a counted callback; this is not a JNI/device test.
#pragma once
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <ranges>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using jint = int;
namespace facebook::jni {
struct JavaObject;
struct JavaMethod {
  void operator()(const std::shared_ptr<JavaObject>& object, int tag) const;
};
struct JavaClass {
  template <class Signature> JavaMethod getMethod(const char*) { return {}; }
};
struct JavaObject {
  std::atomic<int> calls{0};
  std::function<void(int)> onNotify;
  JavaClass* getClass() { static JavaClass klass; return &klass; }
};
inline void JavaMethod::operator()(const std::shared_ptr<JavaObject>& object, int tag) const {
  if (!object) throw std::runtime_error("notification targeted an invalid JNI reference");
  ++object->calls;
  if (object->onNotify) object->onNotify(tag);
}
template<class T> using alias_ref = std::shared_ptr<T>;
template<class T> using global_ref = std::shared_ptr<T>;
template<class T> using local_ref = std::shared_ptr<T>;
template<class T> auto make_global(const alias_ref<T>& object) { return object; }
// fbjni's real makeNativeMethod is a macro accepting unbound member names.
#define makeNativeMethod(name, method) 0
template<class T> struct HybridClass {
  using HybridBase = HybridClass<T>;
  using javaobject = JavaObject;
  using jhybridobject = JavaObject;
  struct jhybriddata {};
  template<class... A> static local_ref<jhybriddata> makeCxxInstance(A&&...) { return {}; }
  static void registerHybrid(std::initializer_list<int>) {}
};
}

namespace facebook::react {
using SurfaceId = int;
struct ShadowView { const char* componentName = nullptr; int tag = 0; };
struct ShadowViewMutation {
  enum class Type { Remove, Insert };
  Type type = Type::Remove;
  ShadowView oldChildShadowView;
};
using ShadowViewMutationList = std::vector<ShadowViewMutation>;
struct TransactionTelemetry {};
struct MountingTransaction {
  using Number = long;
  SurfaceId surface;
  Number number;
  ShadowViewMutationList mutations;
  MountingTransaction(SurfaceId s, Number n, ShadowViewMutationList m, const TransactionTelemetry&)
      : surface(s), number(n), mutations(std::move(m)) {}
};
class MountingOverrideDelegate {
 public:
  virtual bool shouldOverridePullTransaction() const = 0;
  virtual ~MountingOverrideDelegate() = default;
  virtual std::optional<MountingTransaction> pullTransaction(
      SurfaceId, MountingTransaction::Number, const TransactionTelemetry&, ShadowViewMutationList) const = 0;
};
struct MountingCoordinator {
  mutable std::mutex mutex;
  mutable std::vector<std::weak_ptr<const MountingOverrideDelegate>> delegates;
  void setMountingOverrideDelegate(std::weak_ptr<const MountingOverrideDelegate> delegate) const {
    std::lock_guard lock(mutex);
    delegates.push_back(std::move(delegate));
  }
  std::vector<std::shared_ptr<const MountingOverrideDelegate>> listeners() const {
    std::lock_guard lock(mutex);
    std::vector<std::shared_ptr<const MountingOverrideDelegate>> result;
    for (auto& value : delegates) if (auto listener = value.lock()) result.push_back(listener);
    return result;
  }
};
struct ShadowTree {
  std::shared_ptr<const MountingCoordinator> coordinator = std::make_shared<MountingCoordinator>();
  auto getMountingCoordinator() const { return coordinator; }
};
struct ShadowTreeRegistry {
  ShadowTree tree;
  template<class F> void enumerate(F&& callback) const { bool stop = false; callback(tree, stop); }
};
struct UIManager {
  ShadowTreeRegistry registry;
  const ShadowTreeRegistry& getShadowTreeRegistry() const { return registry; }
};
struct Scheduler {
  std::shared_ptr<UIManager> manager;
  auto getUIManager() const {
    auto result = manager;
    // Model binding work after taking the reference. Otherwise the refcount
    // operations can accidentally order the two lazy-init calls in a fast shim.
    std::this_thread::sleep_for(std::chrono::milliseconds(3));
    return result;
  }
};
struct Binding {
  Scheduler scheduler;
  Scheduler* getScheduler() { return &scheduler; }
};
struct JFabricUIManager {
  using javaobject = JFabricUIManager;
  Binding binding;
  bool accessible = true;
  explicit JFabricUIManager(std::shared_ptr<UIManager> manager) { binding.scheduler.manager = std::move(manager); }
  Binding* getBinding() {
    if (!accessible) throw std::runtime_error("accessed Fabric after invalidation");
    return &binding;
  }
};
}
