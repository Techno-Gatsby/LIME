// Lime's HEC-DSS reader, built on HEC's own heclib (MIT). One command per run; results go to stdout.
//   dsstool catalog FILE.dss            one line per record: TYPE<TAB>PATHNAME
//   dsstool ts FILE.dss PATHNAME        a time series: header lines (# units, # type), then ISO-TIME<TAB>VALUE
//   dsstool sample FILE.dss             writes a small sample file (two hydrographs and a rainfall record)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "hecdss.h"

static const char *MON[] = { "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC" };
static void dssDate(int julian, char *out) { int y, m, d; hec_dss_julianToYearMonthDay(julian, &y, &m, &d); sprintf(out, "%02d%s%04d", d, MON[m - 1], y); }
static void dssTime(int secs, char *out) { sprintf(out, "%02d%02d", secs / 3600, (secs % 3600) / 60); }

static int catalog(dss_file *dss) {
  int n = hec_dss_record_count(dss), size = hec_dss_CONSTANT_MAX_PATH_SIZE();
  if (n <= 0) return 0;
  char *paths = calloc((size_t)n, (size_t)size);
  int *types = calloc((size_t)n, sizeof(int));
  int got = hec_dss_catalog(dss, paths, types, NULL, n, size);
  for (int i = 0; i < got; i++) printf("%d\t%s\n", types[i], paths + (size_t)i * size);
  free(paths); free(types);
  return 0;
}

static int series(dss_file *dss, const char *path) {
  int fj = 0, fs = 0, lj = 0, ls = 0;
  int st = hec_dss_tsGetDateTimeRange(dss, path, 1, &fj, &fs, &lj, &ls);
  if (st != 0) { fprintf(stderr, "no time series at %s (%d)\n", path, st); return 2; }
  char sd[16], stt[8], ed[16], et[8];
  dssDate(fj, sd); dssTime(fs, stt); dssDate(lj, ed); dssTime(ls, et);
  int n = 0, q = 0;
  st = hec_dss_tsGetSizes(dss, path, sd, stt, ed, et, &n, &q);
  if (st != 0 || n <= 0) { fprintf(stderr, "no values at %s (%d)\n", path, st); return 2; }
  int *times = calloc((size_t)n, sizeof(int)), *quality = calloc((size_t)n * (q > 0 ? q : 1), sizeof(int));
  double *values = calloc((size_t)n, sizeof(double));
  int read = 0, base = 0, gran = 60;
  char units[64] = "", type[64] = "", tz[64] = "";
  st = hec_dss_tsRetrieve(dss, path, sd, stt, ed, et, times, values, n, &read, quality, q, &base, &gran, units, sizeof units, type, sizeof type, tz, sizeof tz);
  if (st != 0) { fprintf(stderr, "could not read %s (%d)\n", path, st); return 2; }
  printf("# units\t%s\n# type\t%s\n# timezone\t%s\n", units, type, tz);
  for (int i = 0; i < read; i++) {
    long long t = (long long)times[i] * gran;              // seconds since the base date
    int day = base + (int)(t / 86400), secs = (int)(t % 86400);
    if (secs < 0) { secs += 86400; day--; }
    int y, m, d; hec_dss_julianToYearMonthDay(day, &y, &m, &d);
    if (values[i] <= -3.402823466e38 || values[i] == -901.0 || values[i] == -902.0) printf("%04d-%02d-%02dT%02d:%02d:%02d\t\n", y, m, d, secs / 3600, (secs % 3600) / 60, secs % 60);
    else printf("%04d-%02d-%02dT%02d:%02d:%02d\t%.6g\n", y, m, d, secs / 3600, (secs % 3600) / 60, secs % 60, values[i]);
  }
  free(times); free(values); free(quality);
  return 0;
}

static int sample(dss_file *dss) {
  enum { N = 96 };
  double inflow[N], outflow[N], rain[N];
  for (int i = 0; i < N; i++) {
    double t = i * 0.25, base = 2.0;                        // hours from the start, 15-minute steps
    inflow[i] = base + 48.0 * (t > 1 ? (t - 1) / 3.0 : 0) * (t < 4 ? 1 : 0) + (t >= 4 && t < 13 ? 48.0 * (1.0 - (t - 4) / 9.0) : 0);
    outflow[i] = i < 3 ? base : 0.85 * inflow[i - 3] + 0.15 * base;
    rain[i] = (t >= 0.5 && t < 3.5) ? (t < 2 ? 4.0 * (t - 0.5) : 4.0 * (3.5 - t)) : 0.0;
  }
  int a = hec_dss_tsStoreRegular(dss, "/WADI HATTA/BASIN-1/FLOW//15MIN/RUN:STORM 100YR/", "01JAN2024", "0015", inflow, N, NULL, 0, 0, "M3/S", "INST-VAL", "", 0);
  int b = hec_dss_tsStoreRegular(dss, "/WADI HATTA/OUTLET/FLOW//15MIN/RUN:STORM 100YR/", "01JAN2024", "0015", outflow, N, NULL, 0, 0, "M3/S", "INST-VAL", "", 0);
  int c = hec_dss_tsStoreRegular(dss, "/WADI HATTA/GAGE-1/PRECIP-INC//15MIN/OBS/", "01JAN2024", "0015", rain, N, NULL, 0, 0, "MM", "PER-CUM", "", 0);
  printf("stored %d %d %d\n", a, b, c);
  return a || b || c;
}

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: dsstool catalog|ts|sample FILE.dss [PATHNAME]\n"); return 1; }
  hec_dss_set_value("mlvl", 0);
  dss_file *dss = NULL;
  int st = hec_dss_open(argv[2], &dss);
  if (st != 0 || !dss) { fprintf(stderr, "could not open %s (%d)\n", argv[2], st); return 3; }
  int r = 1;
  if (!strcmp(argv[1], "catalog")) r = catalog(dss);
  else if (!strcmp(argv[1], "ts") && argc > 3) r = series(dss, argv[3]);
  else if (!strcmp(argv[1], "sample")) r = sample(dss);
  hec_dss_close(dss);
  return r;
}
