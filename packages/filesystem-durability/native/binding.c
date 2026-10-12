#include "sync-group.h"
#include <limits.h>
#include <math.h>
#include <node_api.h>
#include <stdbool.h>
#include <stdlib.h>

typedef struct {
  LervoSyncGroup group;
  napi_env environment;
  napi_async_work work;
  napi_async_cleanup_hook_handle cleanup;
  napi_deferred deferred;
  bool closing;
} SyncWork;

static void execute(napi_env environment, void *data) {
  (void)environment;
  lervoSynchronizeGroup(&((SyncWork *)data)->group);
}

static void cleanupEnvironment(napi_async_cleanup_hook_handle hook, void *data) {
  (void)hook;
  SyncWork *work = data;
  work->closing = true;
  // Running work cannot be cancelled; the cleanup hook holds teardown until completion.
  (void)napi_cancel_async_work(work->environment, work->work);
}

static void complete(napi_env environment, napi_status status, void *data) {
  SyncWork *work = data;
  lervoCloseGroup(&work->group);
  if (!work->closing) {
    napi_value value;
    if (status != napi_ok || work->group.error ||
        work->group.disposition == LERVO_SYNC_FAILED) {
      napi_value message, code;
      if (napi_create_string_utf8(environment, "File synchronization failed.",
                                  NAPI_AUTO_LENGTH, &message) == napi_ok &&
          napi_create_string_utf8(environment, "file_sync_failed", NAPI_AUTO_LENGTH,
                                  &code) == napi_ok &&
          napi_create_error(environment, code, message, &value) == napi_ok)
        (void)napi_reject_deferred(environment, work->deferred, value);
    } else if (napi_get_boolean(environment,
                               work->group.disposition == LERVO_SYNC_COMPLETED,
                               &value) == napi_ok) {
      (void)napi_resolve_deferred(environment, work->deferred, value);
    }
  }
  (void)napi_delete_async_work(environment, work->work);
  (void)napi_remove_async_cleanup_hook(work->cleanup);
  free(work);
}

static napi_value fail(napi_env environment, SyncWork *work, const char *message) {
  if (work) {
    lervoCloseGroup(&work->group);
    if (work->cleanup) (void)napi_remove_async_cleanup_hook(work->cleanup);
    if (work->work) (void)napi_delete_async_work(environment, work->work);
    free(work);
  }
  bool pending = false;
  (void)napi_is_exception_pending(environment, &pending);
  if (!pending) (void)napi_throw_error(environment, "file_sync_failed", message);
  return NULL;
}

static napi_value synchronize(napi_env environment, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2], item, promise, label;
  bool array = false;
  uint32_t length = 0;
  if (napi_get_cb_info(environment, info, &argc, args, NULL, NULL) != napi_ok ||
      argc != 1 || napi_is_array(environment, args[0], &array) != napi_ok || !array ||
      napi_get_array_length(environment, args[0], &length) != napi_ok ||
      !length || length > LERVO_SYNC_GROUP_LIMIT)
    return fail(environment, NULL, "Expected one to sixteen file descriptors.");

  SyncWork *work = calloc(1, sizeof(*work));
  if (!work) return fail(environment, NULL, "Unable to allocate synchronization work.");
  work->environment = environment;
  for (uint32_t i = 0; i < length; i++) {
    double number;
    if (napi_get_element(environment, args[0], i, &item) != napi_ok ||
        napi_get_value_double(environment, item, &number) != napi_ok ||
        !isfinite(number) || number < 0 || number > INT_MAX ||
        number != (double)(int)number)
      return fail(environment, work, "Invalid file descriptor.");
    int owned = lervoDuplicateDescriptor((int)number);
    if (owned < 0) return fail(environment, work, "Unable to retain file descriptor.");
    work->group.descriptors[work->group.count++] = owned;
  }
  if (napi_create_promise(environment, &work->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(environment, "lervo-file-sync", NAPI_AUTO_LENGTH, &label) != napi_ok ||
      napi_create_async_work(environment, NULL, label, execute, complete, work,
                               &work->work) != napi_ok ||
      napi_add_async_cleanup_hook(environment, cleanupEnvironment, work,
                                     &work->cleanup) != napi_ok ||
      napi_queue_async_work(environment, work->work) != napi_ok)
    return fail(environment, work, "Unable to schedule file synchronization.");
  return promise;
}

static napi_value initialize(napi_env environment, napi_value exports) {
  napi_value function;
  if (napi_create_function(environment, "synchronize", NAPI_AUTO_LENGTH, synchronize,
                            NULL, &function) != napi_ok ||
      napi_set_named_property(environment, exports, "synchronize", function) != napi_ok)
    return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
