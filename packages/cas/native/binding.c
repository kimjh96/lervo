#include "cas-io.h"
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

typedef struct { unsigned pending; bool finalized; bool closing; } CasEnvironment;
typedef struct {
  napi_env environment;
  napi_async_work work;
  napi_async_cleanup_hook_handle cleanup;
  napi_deferred deferred;
  napi_ref failure;
  CasEnvironment *owner;
  LervoCasOperation *operations;
  uint32_t count;
  bool closing;
} CasWork;

static void release(CasWork *work) {
  if (work->failure) (void)napi_delete_reference(work->environment, work->failure);
  if (work->work) (void)napi_delete_async_work(work->environment, work->work);
  if (work->cleanup) (void)napi_remove_async_cleanup_hook(work->cleanup);
  work->owner->pending--;
  if (!work->owner->pending && work->owner->finalized) free(work->owner);
  free(work->operations);
  free(work);
}

static napi_value fail(napi_env environment, CasWork *work, const char *code) {
  if (work) release(work);
  bool pending = false;
  (void)napi_is_exception_pending(environment, &pending);
  if (!pending) (void)napi_throw_error(environment, code, "CAS operation could not be admitted.");
  return NULL;
}

static bool stringProperty(napi_env environment, napi_value object,
                           const char *key, const char *text) {
  napi_value value;
  return napi_create_string_utf8(environment, text, NAPI_AUTO_LENGTH, &value) == napi_ok &&
         napi_set_named_property(environment, object, key, value) == napi_ok;
}

static bool numberProperty(napi_env environment, napi_value object,
                           const char *key, uint32_t number) {
  napi_value value;
  return napi_create_uint32(environment, number, &value) == napi_ok &&
         napi_set_named_property(environment, object, key, value) == napi_ok;
}

static bool result(napi_env environment, LervoCasOperation *operation, napi_value *item) {
  napi_value created, bytes;
  if (napi_create_object(environment, item) != napi_ok ||
      napi_get_boolean(environment, operation->created, &created) != napi_ok ||
      napi_set_named_property(environment, *item, "created", created) != napi_ok)
    return false;
  if (operation->disposition == LERVO_CAS_FAILED)
    return stringProperty(environment, *item, "status", "failed") &&
           stringProperty(environment, *item, "code", operation->unsafe ? "unsafe_path" : "system_error") &&
           stringProperty(environment, *item, "syscall", operation->syscall) &&
           numberProperty(environment, *item, "errno", (uint32_t)operation->error) &&
           numberProperty(environment, *item, "pathIndex", operation->pathIndex);
  if (operation->disposition == LERVO_CAS_LARGE)
    return stringProperty(environment, *item, "status", "large");
  return stringProperty(environment, *item, "status", "complete") &&
         napi_create_buffer_copy(environment, operation->length, operation->bytes, NULL, &bytes) == napi_ok &&
         napi_set_named_property(environment, *item, "bytes", bytes) == napi_ok;
}

static void reject(CasWork *work) {
  napi_value error;
  bool pending = false;
  napi_status status = napi_is_exception_pending(work->environment, &pending);
  if (status == napi_ok)
    status = pending ? napi_get_and_clear_last_exception(work->environment, &error)
                     : napi_get_reference_value(work->environment, work->failure, &error);
  if (status == napi_ok) status = napi_reject_deferred(work->environment, work->deferred, error);
  bool exception = true;
  /* Node-API 8 also reports disabled JavaScript as pending_exception without an exception.
     Worker termination can reach completion before this work's cleanup hook runs. */
  if (status == napi_closing || status == napi_cannot_run_js ||
      (status == napi_pending_exception &&
       napi_is_exception_pending(work->environment, &exception) == napi_ok && !exception)) {
    work->owner->closing = true;
    return;
  }
  /* A live environment must settle every admitted promise, even if result allocation fails. */
  if (status != napi_ok)
    napi_fatal_error("lervo-cas", NAPI_AUTO_LENGTH, "Unable to settle CAS work.", NAPI_AUTO_LENGTH);
}

static void complete(napi_env environment, napi_status status, void *data) {
  CasWork *work = data;
  if (!work->closing && !work->owner->closing) {
    napi_value array, item;
    bool valid = status == napi_ok &&
      napi_create_array_with_length(environment, work->count, &array) == napi_ok;
    for (uint32_t i = 0; valid && i < work->count; i++)
      valid = result(environment, &work->operations[i], &item) &&
              napi_set_element(environment, array, i, item) == napi_ok;
    if (!valid || napi_resolve_deferred(environment, work->deferred, array) != napi_ok)
      reject(work);
  }
  release(work);
}

static void execute(napi_env environment, void *data) {
  (void)environment;
  CasWork *work = data;
  for (uint32_t i = 0; i < work->count; i++) lervoExecuteCasOperation(&work->operations[i]);
}

static void cleanupEnvironment(napi_async_cleanup_hook_handle hook, void *data) {
  (void)hook;
  CasWork *work = data;
  work->closing = true;
  work->owner->closing = true;
  /* Cancellation only stops queued work. The hook retains running work until completion. */
  (void)napi_cancel_async_work(work->environment, work->work);
}

static bool copyPath(napi_env environment, napi_value value, char *output) {
  size_t length = 0, written = 0;
  return napi_get_value_string_utf8(environment, value, NULL, 0, &length) == napi_ok &&
         length > 0 && length < LERVO_CAS_PATH_LIMIT &&
         napi_get_value_string_utf8(environment, value, output, LERVO_CAS_PATH_LIMIT, &written) == napi_ok &&
         written == length && strlen(output) == length && output[0] == '/';
}

static bool readOperations(napi_env environment, napi_value array, CasWork *work) {
  for (uint32_t i = 0; i < work->count; i++) {
    napi_value item, value;
    bool isArray;
    uint32_t length;
    if (napi_get_element(environment, array, i, &item) != napi_ok ||
        napi_is_array(environment, item, &isArray) != napi_ok || !isArray ||
        napi_get_array_length(environment, item, &length) != napi_ok ||
        (length != 1 && length != 3)) return false;
    LervoCasOperation *operation = &work->operations[i];
    operation->publish = length == 3;
    for (uint32_t j = 0; j < length; j++) {
      char *path = length == 1 ? operation->target :
        (j == 0 ? operation->temporary : (j == 1 ? operation->prefix : operation->target));
      if (napi_get_element(environment, item, j, &value) != napi_ok ||
          !copyPath(environment, value, path)) return false;
    }
  }
  return true;
}

static napi_value batch(napi_env environment, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2], promise, label, message, code, failure;
  bool array = false;
  uint32_t count = 0;
  CasEnvironment *owner = NULL;
  if (napi_get_cb_info(environment, info, &argc, args, NULL, (void **)&owner) != napi_ok || argc != 1 ||
      napi_is_array(environment, args[0], &array) != napi_ok || !array ||
      napi_get_array_length(environment, args[0], &count) != napi_ok ||
      !count || count > LERVO_CAS_GROUP_LIMIT)
    return fail(environment, NULL, "native_cas_invalid_request");
  if (!owner || owner->closing)
    return fail(environment, NULL, "native_cas_unavailable");
  if (owner->pending >= LERVO_CAS_GROUP_LIMIT)
    return fail(environment, NULL, "native_cas_capacity");
  CasWork *work = calloc(1, sizeof(*work));
  if (!work) return fail(environment, NULL, "native_cas_allocation_failed");
  work->environment = environment;
  work->owner = owner;
  owner->pending++;
  work->count = count;
  work->operations = calloc(count, sizeof(*work->operations));
  if (!work->operations) return fail(environment, work, "native_cas_allocation_failed");
  if (!readOperations(environment, args[0], work))
    return fail(environment, work, "native_cas_invalid_request");
  /* Retain a rejection before scheduling; completion must not depend on allocating an Error. */
  if (napi_create_string_utf8(environment, "CAS result could not be delivered.", NAPI_AUTO_LENGTH, &message) != napi_ok ||
      napi_create_string_utf8(environment, "native_cas_completion_failed", NAPI_AUTO_LENGTH, &code) != napi_ok ||
      napi_create_error(environment, code, message, &failure) != napi_ok ||
      napi_create_reference(environment, failure, 1, &work->failure) != napi_ok ||
      napi_create_promise(environment, &work->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(environment, "lervo-cas-io", NAPI_AUTO_LENGTH, &label) != napi_ok ||
      napi_create_async_work(environment, NULL, label, execute, complete, work, &work->work) != napi_ok ||
      napi_add_async_cleanup_hook(environment, cleanupEnvironment, work, &work->cleanup) != napi_ok ||
      napi_queue_async_work(environment, work->work) != napi_ok)
    return fail(environment, work, "native_cas_schedule_failed");
  return promise;
}

static void finalizeEnvironment(napi_env environment, void *data, void *hint) {
  (void)environment;
  (void)hint;
  CasEnvironment *owner = data;
  owner->finalized = true;
  if (!owner->pending) free(owner);
}

static napi_value initialize(napi_env environment, napi_value exports) {
  napi_value function;
  CasEnvironment *owner = calloc(1, sizeof(*owner));
  if (!owner) return fail(environment, NULL, "native_cas_allocation_failed");
  if (napi_create_function(environment, "batch", NAPI_AUTO_LENGTH, batch, owner, &function) != napi_ok ||
      napi_add_finalizer(environment, function, owner, finalizeEnvironment, NULL, NULL) != napi_ok) {
    free(owner);
    return fail(environment, NULL, "native_cas_unavailable");
  }
  if (napi_set_named_property(environment, exports, "batch", function) != napi_ok)
    return fail(environment, NULL, "native_cas_unavailable");
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
