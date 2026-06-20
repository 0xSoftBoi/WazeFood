// Injectable clock so time-dependent logic (token TTLs, freshness, leaderboard windows)
// is deterministic in tests.

export type Clock = {
  now: () => Date;
};

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}
