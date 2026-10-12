#ifndef LERVO_SYNC_GROUP_H
#define LERVO_SYNC_GROUP_H

#define LERVO_SYNC_GROUP_LIMIT 16

typedef enum {
  LERVO_SYNC_COMPLETED,
  LERVO_SYNC_INELIGIBLE,
  LERVO_SYNC_FAILED
} LervoSyncDisposition;

typedef struct {
  int descriptors[LERVO_SYNC_GROUP_LIMIT];
  unsigned count;
  int error;
  LervoSyncDisposition disposition;
} LervoSyncGroup;

int lervoDuplicateDescriptor(int descriptor);
void lervoCloseGroup(LervoSyncGroup *group);
void lervoSynchronizeGroup(LervoSyncGroup *group);

#endif
