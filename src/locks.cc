#include <locks.h>
#include <node_api.h>
#include <string>

using namespace Napi;

// There is a single LockManager for the process.
namespace piscina {

using Napi::Boolean;
using Napi::CallbackInfo;
using Napi::Error;
using Napi::EscapableHandleScope;
using Napi::HandleScope;
using Napi::Function;
using Napi::FunctionReference;
using Napi::Number;
using Napi::Object;
using Napi::ObjectWrap;
using Napi::Persistent;
using Napi::RangeError;
using Napi::String;
using Napi::TypeError;
using Napi::Value;

namespace locks {

Lock::Lock(const std::string& name, Mode mode) : name_(name), mode_(mode) {}

// Disconnect this Lock from the LockWrap that might be currently holding it.
void Lock::Eject(EjectedReason reason) {
  if (owner_ != nullptr) {
    owner_->lock_ = nullptr;
    owner_->reason_ = reason;
    owner_ = nullptr;
  }
}

Object LockWrap::NewInstance(Napi::Env env, Lock* lock) {
  EscapableHandleScope scope(env);
  Object obj = env.GetInstanceData<LocksInstanceData>()->lock_wrap.New({});
  LockWrap* wrap = LockWrap::Unwrap(obj);
  wrap->lock_ = lock;
  lock->owner_ = wrap;
  return scope.Escape(napi_value(obj)).ToObject();
}

LockWrap::LockWrap(
    const CallbackInfo& info)
    : ObjectWrap<LockWrap>(info) {}

LockWrap::~LockWrap() {
  if (lock_ != nullptr)
    piscina::per_process::lock_manager.Release(lock_);
}

Value LockWrap::Name(const CallbackInfo& info) {
  return lock_ != nullptr
      ? String::New(Env(), lock_->name())
      : Env().Undefined();
}

Value LockWrap::Mode(const CallbackInfo& info) {
  if (lock_ != nullptr)

  switch (lock_->mode()) {
    case Lock::Mode::EXCLUSIVE:
      return String::New(Env(), "exclusive");
    case Lock::Mode::SHARED:
      return String::New(Env(), "shared");
  }

  return Env().Undefined();

}

Value LockWrap::Held(const CallbackInfo& info) {
  return Boolean::New(Env(), lock_ != nullptr);
}

Value LockWrap::EjectedReason(const CallbackInfo& info) {
  return Number::New(Env(), static_cast<int>(reason_));
}

FunctionReference LockWrap::Init(Napi::Env env) {
  Function func = DefineClass(env, "Lock", {
    InstanceMethod("release", &LockWrap::Release),
    InstanceAccessor<&LockWrap::Name>("name"),
    InstanceAccessor<&LockWrap::Mode>("mode"),
    InstanceAccessor<&LockWrap::Held>("held"),
    InstanceAccessor<&LockWrap::EjectedReason>("ejectedReason")
  });
  return Persistent(func);
}

Value LockWrap::Release(const CallbackInfo& info) {
  if (lock_ != nullptr)
    piscina::per_process::lock_manager.Release(lock_);
  return Env().Undefined();
}

LockManager::LockManager() {
  uv_mutex_init(&mutex_);
}

LockManager::~LockManager() {
  uv_mutex_destroy(&mutex_);
}

void LockManager::Release(Lock* lock) {
  lock->Eject(Lock::EjectedReason::RELEASED);
  ScopedLock scoped_lock(&mutex_);
  for (const auto& other : held_) {
    if (other.get() == lock) {
      held_.erase(
          std::remove(held_.begin(), held_.end(), other),
          held_.end());
    }
  }
  ProcessQueue();
}

void LockManager::Request(LockRequest* request) {
  ScopedLock scoped_lock(&mutex_);
  // If request->steal() is true, if there's an existing
  // lock held, we're going to steal it away and grant it
  // to this request.
  if (request->steal()) {
    // It's important to know that while the lock is being
    // stolen from whatever code is using it, that code is
    // still likely running, only without the protection of
    // the lock. So take great care with this.
    for (auto const& lock : held_) {
      if (lock->name() == request->name()) {
        lock->Eject(Lock::EjectedReason::STOLEN);
        held_.erase(
            std::remove(held_.begin(), held_.end(), lock),
            held_.end());
      }
    }
    requests_.push_front(request);
    return ProcessQueue();
  }

  // If request->if_available() is true and IsGrantable() is
  // false, we're going to reject immediately.
  if (request->if_available() && !IsGrantable(request)) {
    return request->Notify(LockRequest::Status::NOT_AVAILABLE);
  }

  // Otherwise, put the request into the queue and process the queue.
  requests_.push_back(request);
  ProcessQueue();
}

void LockManager::Cancel(LockRequest* request) {
  ScopedLock scope_lock(&mutex_);
  for (auto const& req : requests_) {
    if (req == request) {
      req->Notify(LockRequest::Status::CANCELED);
      requests_.erase(
          std::remove(requests_.begin(), requests_.end(), req),
          requests_.end());
      return;
    }
  }
}

bool LockManager::IsGrantable(LockRequest* request) {
  if (request->mode() == Lock::Mode::EXCLUSIVE) {
    for (auto const& lock : held_)
      if (lock->name() == request->name()) return false;

    for (auto const& req : requests_) {
      if (request == req) break;
      if (req->name() == request->name()) return false;
    }
    return true;
  }

  for (auto const& lock : held_) {
    if (lock->name() == request->name() &&
        lock->mode() == Lock::Mode::EXCLUSIVE) {
      return false;
    }
  }

  for (auto const& req : requests_) {
    if (request == req) break;
    if (req->name() == request->name() &&
        req->mode() == Lock::Mode::EXCLUSIVE) {
      return false;
    }
  }
  return true;
}

void LockManager::ProcessQueue() {
  for (auto const& request : requests_) {
    if (IsGrantable(request)) {
      Lock* lock = new Lock(request->name(), request->mode());
      held_.emplace_back(lock);
      requests_.erase(
          std::remove(requests_.begin(), requests_.end(), request),
          requests_.end());
      request->Notify(LockRequest::Status::GRANTED, lock);
    }
  }
}

void LockManager::Snapshot(LockSnapshotCallback callback) {
  ScopedLock scoped_lock(&mutex_);
  for (const auto& request : requests_)
    callback(LockSnapshotType::REQUEST, request->name(), request->mode());
  for (const auto& lock : held_)
    callback(LockSnapshotType::LOCK, lock->name(), lock->mode());
}

void LockRequest::OnNotify() {
  // Create a handle scope?
  // Create a content scope?
  HandleScope scope(Env());
  Number ret_status = Number::New(Env(), static_cast<int>(status_));
  Napi::Value ret_lock = Env().Undefined();
  if (lock_ != nullptr)
    ret_lock = LockWrap::NewInstance(Env(), lock_);
  callback_.Call(Env().Global(), { ret_status, ret_lock });
  uv_close(reinterpret_cast<uv_handle_t*>(&async_), nullptr);
}

uv_loop_t* LockRequest::event_loop() const {
  uv_loop_t* loop;
  napi_get_uv_event_loop(napi_env(Env()), &loop);
  return loop;
}

// info[0] -> string, name of the lock
// info[1] -> int, mode, exclusive vs shared
// info[2] -> bool, if_available
// info[3] -> bool, steal
// info[4] -> function
LockRequest::LockRequest(const CallbackInfo& info)
    : ObjectWrap<LockRequest>(info) {

  if (!info[0].IsString()) {
    throw TypeError::New(
        info.Env(),
        std::string("name must be a string"));
  }

  if (!info[1].IsNumber()) {
    throw TypeError::New(
        info.Env(),
        std::string("mode must be a number"));
  }

  if (!info[2].IsBoolean()) {
    throw TypeError::New(
        info.Env(),
        std::string("if_available must be a boolean"));
  }

  if (!info[3].IsBoolean()) {
    throw TypeError::New(
        info.Env(),
        std::string("steal must be a boolean"));
  }

  if (!info[4].IsFunction()) {
    throw TypeError::New(
        info.Env(),
        std::string("callback must be a function"));
  }

  name_ = info[0].As<String>();
  mode_ = static_cast<Lock::Mode>(int32_t(info[1].As<Number>()));

  if (mode_ > Lock::Mode::SHARED) {
    throw RangeError::New(
        info.Env(),
        std::string("invalid lock mode"));
  }

  if (bool(info[2].As<Boolean>()))
    flags_ = static_cast<Flag>(static_cast<int>(flags_) | static_cast<int>(Flag::IF_AVAILABLE));

  if (bool(info[3].As<Boolean>()))
    flags_ = static_cast<Flag>(static_cast<int>(flags_) | static_cast<int>(Flag::STEAL));

  callback_ = Persistent(info[4].As<Function>());

  async_.data = this;
  uv_async_init(event_loop(), &async_, [](uv_async_t* handle) {
    LockRequest* req = static_cast<LockRequest*>(handle->data);
    req->OnNotify();
  });

  piscina::per_process::lock_manager.Request(this);
}

Value LockRequest::Cancel(const CallbackInfo& info) {
  piscina::per_process::lock_manager.Cancel(this);
  return Env().Undefined();
}

void LockRequest::Init(Napi::Env env, Napi::Object exports) {
  Function func =
      DefineClass(env,
                  "LockRequest",
                  {
                    InstanceMethod("cancel", &LockRequest::Cancel)
                  });

  LocksInstanceData* instance_data = new LocksInstanceData();
  instance_data->lock_request = Persistent(func);
  instance_data->lock_wrap = LockWrap::Init(env);

  env.SetInstanceData(instance_data);
  exports["LockRequest"] = func;
}

void LockRequest::Notify(Status status, Lock* lock) {
  status_ = status;
  lock_ = lock;
  uv_async_send(&async_);
}

}  // namespace locks
namespace per_process {
locks::LockManager lock_manager;
}  // namespace per_process
}  // namespace piscina

Napi::Value Snapshot(const Napi::CallbackInfo& info) {
  Napi::Object obj = Napi::Object::New(info.Env());
  Napi::Array pending = Napi::Array::New(info.Env());
  Napi::Array held = Napi::Array::New(info.Env());
  obj["pending"] = pending;
  obj["held"] = held;

  piscina::per_process::lock_manager.Snapshot([&](
      piscina::locks::LockSnapshotType type,
      const std::string& name,
      piscina::locks::Lock::Mode mode) {
    Napi::Object item = Napi::Object::New(info.Env());
    item["name"] = name;
    item["mode"] = Napi::String::New(
        info.Env(),
        mode == piscina::locks::Lock::Mode::EXCLUSIVE
            ? "exclusive" : "shared");
    switch (type) {
      case piscina::locks::LockSnapshotType::REQUEST:
        pending[pending.Length()] = item;
        break;
      case piscina::locks::LockSnapshotType::LOCK:
        held[held.Length()] = item;
        break;
    }
  });
  return obj;
}

Object Init(Env env, Object exports) {
  piscina::locks::LockRequest::Init(env, exports);
  exports.Set(
      Napi::String::New(env, "snapshot"),
      Napi::Function::New(env, Snapshot));
  return exports;
}

NODE_API_MODULE(piscina_locks, Init)
