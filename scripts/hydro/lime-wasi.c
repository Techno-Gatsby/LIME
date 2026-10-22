// Lime: the few system calls SWMM and HEC-DSS need that WASI lacks.
// Temporary files go to $LIME_TMP (a folder the host maps in), and $LIME_CWD becomes the working folder, so files a
// model names by a relative path (rainfall, hot start, interface files) are found beside it. A DSS file is only ever
// opened by one run at a time here, so record locks always succeed.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/types.h>

static unsigned lime_seq = 0;
int lime_mkstemp(char *tmpl) {
  const char *dir = getenv("LIME_TMP");
  char name[64];
  for (int tries = 0; tries < 1000; tries++) {
    snprintf(name, sizeof name, "%s%slime%06u", dir ? dir : "", dir ? "/" : "", ++lime_seq);
    int fd = open(name, O_CREAT | O_EXCL | O_RDWR, 0600);
    if (fd >= 0) { strcpy(tmpl, name); return fd; }
  }
  return -1;
}
int lime_lockf(int fd, int cmd, off_t len) { (void)fd; (void)cmd; (void)len; return 0; }
int lime_kill(int pid, int sig) { (void)pid; (void)sig; return 0; }
__attribute__((constructor)) static void lime_cwd(void) {
  const char *d = getenv("LIME_CWD");
  if (d && *d) chdir(d);
}
