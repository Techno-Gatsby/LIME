// Lime: declarations for the WASI shims (see lime-wasi.c), included before every source file.
#include <sys/types.h>
int lime_mkstemp(char *tmpl);
int lime_lockf(int fd, int cmd, off_t len);
int lime_kill(int pid, int sig);
#define mkstemp lime_mkstemp
#define lockf lime_lockf
#define kill lime_kill
#ifndef F_ULOCK
#define F_ULOCK 0
#define F_LOCK 1
#define F_TLOCK 2
#define F_TEST 3
#endif
