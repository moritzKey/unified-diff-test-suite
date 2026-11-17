/* What FreeBSD's usr.bin/patch needs from its libc and glibc does not provide. */
#define _GNU_SOURCE 1
#include <errno.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>

static inline long long
strtonum(const char *s, long long lo, long long hi, const char **errstr)
{
	char *end;
	long long v;

	errno = 0;
	v = strtoll(s, &end, 10);
	if (s == end || *end != '\0') {
		*errstr = "invalid";
		return 0;
	}
	if (errno == ERANGE || v < lo || v > hi) {
		*errstr = v < lo ? "too small" : "too large";
		errno = ERANGE;
		return 0;
	}
	*errstr = NULL;
	return v;
}

static inline void *
reallocf(void *p, size_t n)
{
	void *q = realloc(p, n);

	if (q == NULL && n != 0)
		free(p);
	return q;
}

/* glibc has no optreset. patch also sets optind, which is enough when, as here, every argument is an option. */
static int optreset __attribute__((unused));

/* glibc's struct dirent has no d_namlen. It is used only to find numbered backups. */
#define d_namlen d_reclen * 0 + strlen(dp->d_name)
