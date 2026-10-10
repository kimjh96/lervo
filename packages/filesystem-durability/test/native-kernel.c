#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <unistd.h>

static int scenario, syncs, fulls, duplicates, closes, stats, mounts;
static int interrupted;
static int fakeStat(int fd, struct stat *entry) {
  stats++;
  if (scenario == 9 && !interrupted++) { errno = EINTR; return -1; }
  if (scenario == 10) { errno = EIO; return -1; }
  memset(entry, 0, sizeof(*entry));
  entry->st_mode = scenario == 1 && fd == 2 ? S_IFDIR : S_IFREG;
  entry->st_dev = scenario == 2 && fd == 2 ? 2 : 1;
  return 0;
}
static int fakeMount(int fd, struct statfs *mount) {
  mounts++;
  if (scenario == 11 && !interrupted++) { errno = EINTR; return -1; }
  if (scenario == 12) { errno = EIO; return -1; }
  memset(mount, 0, sizeof(*mount));
  strcpy(mount->f_fstypename, scenario == 3 ? "hfs" : "apfs");
  mount->f_flags = scenario == 4 ? 0 : MNT_LOCAL;
  mount->f_fsid.val[0] = scenario == 5 && fd == 2 ? 2 : 1;
  return 0;
}
static int fakeSync(int fd) {
  (void)fd;
  syncs++;
  if (scenario == 6) { errno = EIO; return -1; }
  if (scenario == 13 && !interrupted++) { errno = EINTR; return -1; }
  return 0;
}
static int fakeFcntl(int fd, int command, ...) {
  if (command == F_DUPFD_CLOEXEC) {
    duplicates++;
    if (scenario == 15 && !interrupted++) { errno = EINTR; return -1; }
    return fd + 100;
  }
  assert(command == F_FULLFSYNC);
  fulls++;
  if (scenario == 7) { errno = EIO; return -1; }
  if (scenario == 14 && !interrupted++) { errno = EINTR; return -1; }
  return 0;
}
static int fakeClose(int fd) {
  (void)fd;
  closes++;
  if (scenario == 8) { errno = EINTR; return -1; }
  return 0;
}
#define fstat fakeStat
#define fstatfs fakeMount
#define fsync fakeSync
#define fcntl fakeFcntl
#define close fakeClose
#include "../native/sync-group.c"

static LervoSyncGroup run(unsigned count, int mode) {
  scenario = mode;
  syncs = fulls = duplicates = closes = stats = mounts = interrupted = 0;
  LervoSyncGroup group = {.count = count};
  for (unsigned i = 0; i < count; i++) group.descriptors[i] = (int)i + 1;
  lervoSynchronizeGroup(&group);
  return group;
}
int main(void) {
  LervoSyncGroup group = run(1, 0);
  assert(group.disposition == LERVO_SYNC_COMPLETED && syncs == 0 && fulls == 1);
  group = run(4, 0);
  assert(group.disposition == LERVO_SYNC_COMPLETED && syncs == 3 && fulls == 1);
  group = run(4, 1);
  assert(group.error == EINVAL && syncs == 0 && fulls == 0);
  for (int mode = 2; mode <= 5; mode++) {
    group = run(4, mode);
    assert(group.disposition == LERVO_SYNC_INELIGIBLE && !group.error && !syncs && !fulls);
  }
  group = run(4, 6);
  assert(group.error == EIO && syncs == 1 && fulls == 0);
  group = run(4, 7);
  assert(group.error == EIO && syncs == 3 && fulls == 1);
  group = run(4, 8);
  lervoCloseGroup(&group);
  assert(group.error == EINTR && closes == 4 && group.count == 0);
  group = run(4, 9);
  assert(group.disposition == LERVO_SYNC_COMPLETED && stats == 5);
  group = run(4, 10);
  assert(group.error == EIO && !syncs && !fulls);
  group = run(4, 11);
  assert(group.disposition == LERVO_SYNC_COMPLETED && mounts == 5);
  group = run(4, 12);
  assert(group.error == EIO && !syncs && !fulls);
  group = run(4, 13);
  assert(group.disposition == LERVO_SYNC_COMPLETED && syncs == 4 && fulls == 1);
  group = run(4, 14);
  assert(group.disposition == LERVO_SYNC_COMPLETED && syncs == 3 && fulls == 2);
  (void)run(1, 15);
  interrupted = 0;
  assert(lervoDuplicateDescriptor(5) == 105 && duplicates == 2);
  group = run(0, 0);
  assert(group.error == EINVAL && !syncs && !fulls);
  puts("18 kernel boundary scenarios passed");
  return 0;
}
