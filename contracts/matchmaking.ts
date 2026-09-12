export const ONLINE_OPPONENT_COUNTS = [1, 2, 3] as const;
export type OnlineOpponentCount = (typeof ONLINE_OPPONENT_COUNTS)[number];

export const MATCHMAKING_QUEUE_TTL_MS = 90_000;
export const MATCHMAKING_MATCH_TTL_MS = 12 * 60 * 60_000;

export type MatchmakingStatus = "searching" | "matched";

export function totalPlayersFor(opponentCount: OnlineOpponentCount) {
  return opponentCount + 1;
}

export function opponentsStillNeeded(
  opponentCount: OnlineOpponentCount,
  queuedPlayers: number,
) {
  return Math.max(0, totalPlayersFor(opponentCount) - queuedPlayers);
}
