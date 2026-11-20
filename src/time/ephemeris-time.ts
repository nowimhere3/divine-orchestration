const unixEpochJd = 2440587.5;
const millisPerDay = 86_400_000;
export const SECONDS_PER_DAY = 86400;

function fractionalYear(jd: number) {
  const ms = (jd - unixEpochJd) * millisPerDay;
  const year = new Date(ms).getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  return year + (ms - start) / (Date.UTC(year + 1, 0, 1) - start);
}

type DeltaT = (year: number) => number;

export function instantFromUt(jdUt: number, modelDeltaTSeconds: DeltaT) {
  const deltaTYear = fractionalYear(jdUt);
  return { jdUt, jdTt: jdUt + modelDeltaTSeconds(deltaTYear) / SECONDS_PER_DAY, deltaTYear };
}

export function instantFromTt(jdTt: number, modelDeltaTSeconds: DeltaT) {
  const estimate = jdTt - modelDeltaTSeconds(fractionalYear(jdTt)) / SECONDS_PER_DAY;
  const deltaTYear = fractionalYear(estimate);
  return { jdTt, jdUt: jdTt - modelDeltaTSeconds(deltaTYear) / SECONDS_PER_DAY, deltaTYear };
}
