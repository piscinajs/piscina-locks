#ifndef LOCKS_H_
#define LOCKS_H_

#include <napi.h>
#include <uv.h>
#include <functional>
#include <string>
#include <deque>

namespace piscina {
namespace locks {

struct ScopedLock {
  uv_mutex_t* mutex;
  ScopedLock(uv_mutex_t* mutex_) : mutex(mutex_) {
    uv_mutex_lock(mutex);
  }
  ~ScopedLock() {
    uv_mutex_unlock(mutex);
  }
};

struct LocksInstanceData {
  Napi::FunctionReference lock_request;
  Napi::FunctionReference lock_wrap;
};

class LockWrap;

class Lock {
 public:
  enum class Mode {
    EXCLUSIVE,
    SHARED
  };

  enum class EjectedReason {
    NONE,
    RELEASED,
    STOLEN
  };

  Lock(const std::string& name, Mode mode);

  const std::string& name() const { return name_; }
  Mode mode() const { return mode_; }

  void Eject(EjectedReason reason);

 private:
  std::string name_;
  Lock::Mode mode_;

  LockWrap* owner_ = nullptr;
  friend class LockWrap;
};

class LockWrap : public Napi::ObjectWrap<LockWrap> {
 public:
  static Napi::FunctionReference Init(Napi::Env env);
  static Napi::Object NewInstance(Napi::Env env, Lock* lock);

  LockWrap(const Napi::CallbackInfo& info);
  ~LockWrap();

  Napi::Value Name(const Napi::CallbackInfo& info);
  Napi::Value Mode(const Napi::CallbackInfo& info);
  Napi::Value Held(const Napi::CallbackInfo& info);
  Napi::Value EjectedReason(const Napi::CallbackInfo& info);

  Lock* lock() const { return lock_; }

 private:
  Napi::Value Release(const Napi::CallbackInfo& info);

  Lock* lock_ = nullptr;
  Lock::EjectedReason reason_ = Lock::EjectedReason::NONE;
  friend class Lock;
};

class LockRequest : public Napi::ObjectWrap<LockRequest> {
 public:
  enum class Flag {
    NONE,
    IF_AVAILABLE = 1,
    STEAL = 2
  };

  enum class Status {
    GRANTED,
    NOT_AVAILABLE,
    CANCELED
  };

  static void Init(Napi::Env env, Napi::Object exports);

  const std::string& name() const { return name_; }
  Lock::Mode mode() const { return mode_; }

  inline bool steal() const {
    return static_cast<int>(flags_) & static_cast<int>(Flag::STEAL);
  }

  inline bool if_available() const {
    return static_cast<int>(flags_) & static_cast<int>(Flag::IF_AVAILABLE);
  }

  LockRequest(const Napi::CallbackInfo& info);

  void Notify(Status status, Lock* lock = nullptr);

  uv_loop_t* event_loop() const;

 private:
  Napi::Value Cancel(const Napi::CallbackInfo& info);

  static void OnAsync(uv_async_t* handle);
  void OnNotify();

  uv_async_t async_;
  std::string name_;
  Lock::Mode mode_;
  Flag flags_ = Flag::NONE;
  Napi::FunctionReference callback_;
  Lock* lock_ = nullptr;
  Status status_ = Status::GRANTED;
};

enum class LockSnapshotType {
  REQUEST,
  LOCK
};

using LockSnapshotCallback =
    std::function<void(LockSnapshotType, const std::string&, Lock::Mode)>;

class LockManager {
 public:
  LockManager();
  ~LockManager();
  void Request(LockRequest* request);
  void Cancel(LockRequest* request);

  void Release(Lock* lock);

  void Snapshot(LockSnapshotCallback cb);

 private:
  bool IsGrantable(LockRequest* request);
  void ProcessQueue();

  std::deque<LockRequest*> requests_;

  // The LockManager owns the locks. Pointer references to the
  // Lock will be held by LockWrap while the lock is held but
  // the LockManager controls the lifetime.
  std::deque<std::unique_ptr<Lock>> held_;

  uv_mutex_t mutex_;
};

}  // namespace locks

namespace per_process {
extern locks::LockManager lock_manager;
}  // namespace per_process
}  // namespace piscina

#endif  // LOCKS_H_
