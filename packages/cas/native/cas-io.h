#ifndef LERVO_CAS_IO_H
#define LERVO_CAS_IO_H

#include <stdbool.h>
#include <stddef.h>

#define LERVO_CAS_GROUP_LIMIT 16
#define LERVO_CAS_PATH_LIMIT 4096
#define LERVO_CAS_BYTE_LIMIT 65536

typedef enum {
  LERVO_CAS_COMPLETE,
  LERVO_CAS_LARGE,
  LERVO_CAS_FAILED
} LervoCasDisposition;

typedef struct {
  char temporary[LERVO_CAS_PATH_LIMIT];
  char prefix[LERVO_CAS_PATH_LIMIT];
  char target[LERVO_CAS_PATH_LIMIT];
  unsigned char bytes[LERVO_CAS_BYTE_LIMIT + 1];
  size_t length;
  bool publish;
  bool created;
  bool unsafe;
  int error;
  unsigned pathIndex;
  const char *syscall;
  LervoCasDisposition disposition;
} LervoCasOperation;

/* Inputs are copied paths. This owner neither synchronizes nor removes temporary files. */
void lervoExecuteCasOperation(LervoCasOperation *operation);

#endif
