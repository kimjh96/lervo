#include "sync-group.h"
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <unistd.h>

int lervoDuplicateDescriptor(int descriptor) {
  int result;
  do {
    result = fcntl(descriptor, F_DUPFD_CLOEXEC, 0);
  } while (result < 0 && errno == EINTR);
  return result;
}

void lervoCloseGroup(LervoSyncGroup *group) {
  for (unsigned i = 0; i < group->count; i++) {
    // Never retry close: another thread may have reused the descriptor.
    if (close(group->descriptors[i]) < 0 && !group->error)
      group->error = errno;
  }
  group->count = 0;
}

void lervoSynchronizeGroup(LervoSyncGroup *group) {
  dev_t device = 0;
  fsid_t filesystem = {{0, 0}};
  group->disposition = LERVO_SYNC_FAILED;
  if (!group->count || group->count > LERVO_SYNC_GROUP_LIMIT) {
    group->error = EINVAL;
    return;
  }
  for (unsigned i = 0; i < group->count; i++) {
    struct stat entry;
    struct statfs mount;
    int result;
    do {
      result = fstat(group->descriptors[i], &entry);
    } while (result < 0 && errno == EINTR);
    if (result < 0) {
      group->error = errno;
      return;
    }
    if (!S_ISREG(entry.st_mode)) {
      group->error = EINVAL;
      return;
    }
    do {
      result = fstatfs(group->descriptors[i], &mount);
    } while (result < 0 && errno == EINTR);
    if (result < 0) {
      group->error = errno;
      return;
    }
    if (strcmp(mount.f_fstypename, "apfs") || !(mount.f_flags & MNT_LOCAL) ||
        (i && (entry.st_dev != device ||
               memcmp(&mount.f_fsid, &filesystem, sizeof(filesystem))))) {
      // Eligibility returns before the first synchronization call.
      group->disposition = LERVO_SYNC_INELIGIBLE;
      return;
    }
    device = entry.st_dev;
    filesystem = mount.f_fsid;
  }
  for (unsigned i = 0; i + 1 < group->count; i++) {
    int result;
    do {
      result = fsync(group->descriptors[i]);
    } while (result < 0 && errno == EINTR);
    if (result < 0) {
      group->error = errno;
      return;
    }
  }
  int result;
  // F_FULLFSYNC includes this descriptor's fsync and persists prior same-device fsyncs.
  do {
    result = fcntl(group->descriptors[group->count - 1], F_FULLFSYNC, 0);
  } while (result < 0 && errno == EINTR);
  if (result < 0) {
    group->error = errno;
    return;
  }
  group->disposition = LERVO_SYNC_COMPLETED;
}
