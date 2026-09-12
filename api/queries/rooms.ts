import { getDb } from "./connection";
import { rooms, playerStats, matches, users, type Room } from "@db/schema";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { GameState } from "@contracts/rummy";

export async function getRoomByCode(code: string): Promise<Room | undefined> {
  return getDb().query.rooms.findFirst({ where: eq(rooms.code, code) });
}

export type RoomMutationOutcome<T> = {
  result: T;
  destroyed: boolean;
};

type DestroyPredicate<T> = (state: GameState, room: Room, result: T) => boolean;
type ConditionalRoomMutation<T> = {
  result: T;
  /** `false` berarti state hanya dibaca sehingga versi room tidak dinaikkan. */
  changed: boolean;
};

async function mutateRoom<T>(
  code: string,
  fn: (state: GameState, room: Room) => T | Promise<T>,
  shouldDestroy?: DestroyPredicate<T>,
): Promise<RoomMutationOutcome<T>> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await getRoomByCode(code);
    if (!room) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Room tidak ditemukan" });
    }
    const state = room.state;
    const result = await fn(state, room);
    const destroy = shouldDestroy?.(state, room, result) ?? false;
    const res = destroy
      ? await getDb()
          .delete(rooms)
          .where(and(eq(rooms.code, code), eq(rooms.version, room.version)))
      : await getDb()
          .update(rooms)
          .set({ state, status: state.status, version: room.version + 1 })
          .where(and(eq(rooms.code, code), eq(rooms.version, room.version)));
    const affected = (res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 1;
    if (affected > 0) return { result, destroyed: destroy };
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "Room sedang sibuk, coba lagi sesaat",
  });
}

/**
 * Baca → mutasi → simpan dengan optimistic locking (kolom version).
 * Retry hingga 5x bila ada penulisan bersamaan.
 */
export async function withRoom<T>(
  code: string,
  fn: (state: GameState, room: Room) => T | Promise<T>,
): Promise<T> {
  return (await mutateRoom(code, fn)).result;
}

/**
 * Baca room dan simpan hanya bila callback benar-benar mengubah state.
 *
 * Endpoint polling memakai helper ini agar room yang sedang menunggu,
 * hasilnya sudah selesai, atau giliran pemain manusia tidak terus-menerus
 * menaikkan optimistic-lock version. Hal tersebut penting supaya aksi keluar
 * room tidak bertabrakan dengan write no-op dari polling.
 */
export async function withRoomIfChanged<T>(
  code: string,
  fn: (
    state: GameState,
    room: Room,
  ) => ConditionalRoomMutation<T> | Promise<ConditionalRoomMutation<T>>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await getRoomByCode(code);
    if (!room) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Room tidak ditemukan" });
    }
    const state = room.state;
    const outcome = await fn(state, room);
    if (!outcome.changed) return outcome.result;

    const res = await getDb()
      .update(rooms)
      .set({ state, status: state.status, version: room.version + 1 })
      .where(and(eq(rooms.code, code), eq(rooms.version, room.version)));
    const affected = (res as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 1;
    if (affected > 0) return outcome.result;
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "Room sedang sibuk, coba lagi sesaat",
  });
}

/**
 * Varian `withRoom` untuk lifecycle room. Penghapusan memakai version check
 * yang sama dengan update biasa, sehingga dua pemain yang keluar bersamaan
 * tetap aman: pemain terakhir yang berhasil menulis akan menghapus room.
 */
export async function withRoomAndDestroyIf<T>(
  code: string,
  fn: (state: GameState, room: Room) => T | Promise<T>,
  shouldDestroy: DestroyPredicate<T>,
): Promise<RoomMutationOutcome<T>> {
  return mutateRoom(code, fn, shouldDestroy);
}

/** Catat hasil pertandingan & update statistik pemain (sekali saja). */
export async function maybeRecordMatch(room: Room, state: GameState) {
  if (state.status !== "finished" || state.statsRecorded) return;
  state.statsRecorded = true;

  const winner = state.players.find((p) => p.seat === state.winnerSeat);
  if (!winner) return;

  await getDb().insert(matches).values({
    roomCode: room.code,
    winnerName: winner.name,
    winnerUserId: winner.userId,
    targetScore: state.targetScore,
    rounds: state.round,
    players: state.players.map((p) => ({
      name: p.name,
      userId: p.userId,
      isBot: p.isBot,
      score: p.score,
    })),
  });

  for (const p of state.players) {
    if (p.userId == null) continue;
    const roundsWon = state.roundHistory.filter(
      (r) => r.winnerSeat === p.seat,
    ).length;
    const rummies = state.roundHistory.filter(
      (r) =>
        r.winnerSeat === p.seat &&
        (r.reason === "tutup" || r.reason === "tutupJoker"),
    ).length;
    const won = p.seat === state.winnerSeat ? 1 : 0;

    const existing = await getDb().query.playerStats.findFirst({
      where: eq(playerStats.userId, p.userId),
    });
    if (existing) {
      await getDb()
        .update(playerStats)
        .set({
          gamesPlayed: existing.gamesPlayed + 1,
          gamesWon: existing.gamesWon + won,
          roundsWon: existing.roundsWon + roundsWon,
          rummyCount: existing.rummyCount + rummies,
          totalPoints: existing.totalPoints + p.score,
        })
        .where(eq(playerStats.userId, p.userId));
    } else {
      await getDb().insert(playerStats).values({
        userId: p.userId,
        gamesPlayed: 1,
        gamesWon: won,
        roundsWon,
        rummyCount: rummies,
        totalPoints: p.score,
      });
    }
  }
}

export async function getLeaderboard() {
  return getDb()
    .select({
      userId: playerStats.userId,
      name: users.name,
      avatar: users.avatar,
      gamesPlayed: playerStats.gamesPlayed,
      gamesWon: playerStats.gamesWon,
      roundsWon: playerStats.roundsWon,
      rummyCount: playerStats.rummyCount,
      totalPoints: playerStats.totalPoints,
    })
    .from(playerStats)
    .innerJoin(users, eq(playerStats.userId, users.id))
    .orderBy(desc(playerStats.gamesWon), desc(playerStats.totalPoints))
    .limit(20);
}

export async function getUserStats(userId: number) {
  return (
    (await getDb().query.playerStats.findFirst({
      where: eq(playerStats.userId, userId),
    })) ?? {
      userId,
      gamesPlayed: 0,
      gamesWon: 0,
      roundsWon: 0,
      rummyCount: 0,
      totalPoints: 0,
      updatedAt: new Date(),
    }
  );
}

export async function getUserMatches(userId: number) {
  const recent = await getDb()
    .select()
    .from(matches)
    .orderBy(desc(matches.createdAt))
    .limit(100);
  return recent
    .filter((m) => m.players.some((p) => p.userId === userId))
    .slice(0, 15);
}
