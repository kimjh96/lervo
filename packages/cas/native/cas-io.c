#include "cas-io.h"
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void failed(LervoCasOperation *operation, const char *syscall,
                   unsigned pathIndex, int error, bool unsafe) {
  operation->disposition = LERVO_CAS_FAILED;
  operation->syscall = syscall;
  operation->pathIndex = pathIndex;
  operation->error = error;
  operation->unsafe = unsafe;
}

static int observe(const char *path, struct stat *stats) {
  int result;
  do { result = lstat(path, stats); } while (result < 0 && errno == EINTR);
  return result;
}

static bool publish(LervoCasOperation *operation) {
  struct stat stats;
  int result;
  do { result = mkdir(operation->prefix, 0777); } while (result < 0 && errno == EINTR);
  if (result < 0 && errno != EEXIST) {
    failed(operation, "mkdir", 1, errno, false);
    return false;
  }
  if (observe(operation->prefix, &stats) < 0) {
    failed(operation, "lstat", 1, errno, false);
    return false;
  }
  if (!S_ISDIR(stats.st_mode)) {
    failed(operation, "lstat", 1, 0, true);
    return false;
  }
  do { result = link(operation->temporary, operation->target); }
  while (result < 0 && errno == EINTR);
  if (result < 0 && errno != EEXIST) {
    failed(operation, "link", 0, errno, false);
    return false;
  }
  operation->created = result == 0;
  return true;
}

static void readObject(LervoCasOperation *operation, int descriptor, unsigned pathIndex) {
  while (operation->length <= LERVO_CAS_BYTE_LIMIT) {
    ssize_t count = read(descriptor, operation->bytes + operation->length,
                         LERVO_CAS_BYTE_LIMIT + 1 - operation->length);
    if (count < 0) {
      if (errno == EINTR) continue;
      failed(operation, "read", pathIndex, errno, false);
      return;
    }
    if (!count) return;
    operation->length += (size_t)count;
    if (operation->length > LERVO_CAS_BYTE_LIMIT) {
      operation->disposition = LERVO_CAS_LARGE;
      return;
    }
  }
}

void lervoExecuteCasOperation(LervoCasOperation *operation) {
  struct stat observed, opened;
  int result, descriptor;
  unsigned pathIndex = operation->publish ? 2 : 0;
  if (operation->publish && !publish(operation)) return;
  if (observe(operation->target, &observed) < 0) {
    failed(operation, "lstat", pathIndex, errno, false);
    return;
  }
  if (!S_ISREG(observed.st_mode)) {
    failed(operation, "lstat", pathIndex, 0, true);
    return;
  }
  /* A raced FIFO must not block a worker before its fstat can reject it. */
  do { descriptor = open(operation->target, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK); }
  while (descriptor < 0 && errno == EINTR);
  if (descriptor < 0) {
    failed(operation, "open", pathIndex, errno, errno == ELOOP);
    return;
  }
  do { result = fstat(descriptor, &opened); } while (result < 0 && errno == EINTR);
  if (result < 0) failed(operation, "fstat", pathIndex, errno, false);
  else if (!S_ISREG(opened.st_mode) || opened.st_dev != observed.st_dev ||
           opened.st_ino != observed.st_ino)
    failed(operation, "fstat", pathIndex, 0, true);
  else readObject(operation, descriptor, pathIndex);
  /* close may already have released the descriptor on failure; never retry it. */
  if (close(descriptor) < 0 && operation->disposition != LERVO_CAS_FAILED)
    failed(operation, "close", pathIndex, errno, false);
}
