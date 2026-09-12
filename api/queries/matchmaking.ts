import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type { User } from "@db/schema";
import {
  MATCHMAKING_MATCH_TTL_MS,
  MATCHMAKING_QUEUE_TTL_MS,
  opponentsStillNeeded,
  totalPlayersFor,
  type OnlineOpponentCount,
} from "@contracts/matchmaking";
import {
  createRoomState,
  generateRoomCode,
  makePlayer,
  pushLog,
  startRound,
} from "@contracts/rummy";
import { env } from "../lib/env";

type QueueRow = RowDataPacket & {
  userId: number;
  opponentCount: OnlineOpponentCount;
  targetScore: number;
  status: "searching" | "matched";
  roomCode: string | null;
  createdAt: Date;
  expiresAt: Date;
};

type QueueCountRow = RowDataPacket & {
  queuedPlayers: number;
};

type RoomStatusRow = RowDataPacket & {
  status: "waiting" | "playing" | "roundEnd" | "finished";
};

type MatchUserRow = RowDataPacket & {
  id: number;
  name: string | null;
  avatar: string | null;
};

export type MatchmakingResult =
  | {
      status: "idle";
    }
  | {
      status: "searching";
      opponentCount: OnlineOpponentCount;
      targetScore: number;
      queuedPlayers: number;
      opponentsNeeded: number;
      expiresAt: Date;
    }
  | {
      status: "matched";
      roomCode: string;
    };

let pool: Pool | undefined;

function getPool() {
  pool ??= mysql.createPool(env.databaseUrl);
  return pool;
}

function expiryFromNow(ms: number) {
  return new Date(Date.now() + ms);
}

async function clearExpired(conn: PoolConnection) {
  await conn.execute(
    "DELETE FROM matchmaking_queue WHERE expiresAt <= CURRENT_TIMESTAMP",
  );
}

async function getActiveRoomStatus(
  conn: PoolConnection,
  roomCode: string,
): Promise<RoomStatusRow["status"] | null> {
  const [rows] = await conn.execute<RoomStatusRow[]>(
    "SELECT status FROM rooms WHERE code = ? LIMIT 1",
    [roomCode],
  );
  return rows[0]?.status ?? null;
}

function isActiveRoom(status: RoomStatusRow["status"] | null) {
  return status === "waiting" || status === "playing" || status === "roundEnd";
}

async function matchingQueueCount(
  conn: PoolConnection,
  opponentCount: OnlineOpponentCount,
  targetScore: number,
) {
  const [rows] = await conn.execute<QueueCountRow[]>(
    `SELECT COUNT(*) AS queuedPlayers
     FROM matchmaking_queue
     WHERE status = 'searching'
       AND opponentCount = ?
       AND targetScore = ?
       AND expiresAt > CURRENT_TIMESTAMP`,
    [opponentCount, targetScore],
  );
  return Number(rows[0]?.queuedPlayers ?? 0);
}

function searchingResult(
  row: Pick<QueueRow, "opponentCount" | "targetScore" | "expiresAt">,
  queuedPlayers: number,
): MatchmakingResult {
  return {
    status: "searching",
    opponentCount: row.opponentCount,
    targetScore: row.targetScore,
    queuedPlayers,
    opponentsNeeded: opponentsStillNeeded(row.opponentCount, queuedPlayers),
    expiresAt: row.expiresAt,
  };
}

async function createMatchedRoom(
  conn: PoolConnection,
  queueRows: QueueRow[],
  opponentCount: OnlineOpponentCount,
  targetScore: number,
) {
  const userIds = queueRows.map((row) => Number(row.userId));
  const userPlaceholders = userIds.map(() => "?").join(", ");
  const [users] = await conn.execute<MatchUserRow[]>(
    `SELECT id, name, avatar FROM users WHERE id IN (${userPlaceholders})`,
    userIds,
  );
  const usersById = new Map(users.map((user) => [Number(user.id), user]));
  const players = userIds.map((userId) => {
    const user = usersById.get(userId);
    if (!user) throw new Error("Pemain antrean tidak ditemukan.");
    return user;
  });

  const host = players[0];
  const state = createRoomState({
    hostUserId: Number(host.id),
    hostName: host.name ?? "Pemain",
    hostAvatar: host.avatar,
    targetScore,
    maxPlayers: totalPlayersFor(opponentCount),
    matchType: "stranger",
  });
  for (const [index, player] of players.slice(1).entries()) {
    state.players.push(
      makePlayer({
        seat: index + 1,
        userId: Number(player.id),
        name: player.name ?? "Pemain",
        avatar: player.avatar,
        isBot: false,
      }),
    );
  }
  startRound(state);
  pushLog(state, "Match lawan pemain online dimulai.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    try {
      await conn.execute(
        `INSERT INTO rooms
          (code, name, status, targetScore, hostUserId, state, version)
         VALUES (?, ?, 'playing', ?, ?, ?, 1)`,
        [
          code,
          `Meja Online · ${totalPlayersFor(opponentCount)} Pemain`,
          targetScore,
          Number(host.id),
          JSON.stringify(state),
        ],
      );
      return code;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Tidak dapat membuat room pertandingan. Coba lagi.");
}

async function queueOrMatch(
  conn: PoolConnection,
  user: User,
  opponentCount: OnlineOpponentCount,
  targetScore: number,
): Promise<MatchmakingResult> {
  await clearExpired(conn);

  const [existingRows] = await conn.execute<QueueRow[]>(
    "SELECT * FROM matchmaking_queue WHERE userId = ? FOR UPDATE",
    [user.id],
  );
  const existing = existingRows[0];
  if (existing?.status === "matched" && existing.roomCode) {
    const activeStatus = await getActiveRoomStatus(conn, existing.roomCode);
    if (isActiveRoom(activeStatus)) {
      return { status: "matched", roomCode: existing.roomCode };
    }
    await conn.execute("DELETE FROM matchmaking_queue WHERE userId = ?", [user.id]);
  } else if (existing?.status === "searching") {
    if (
      existing.opponentCount !== opponentCount ||
      existing.targetScore !== targetScore
    ) {
      throw new Error("Batalkan pencarian aktif sebelum memilih lawan lain.");
    }
    const expiresAt = expiryFromNow(MATCHMAKING_QUEUE_TTL_MS);
    await conn.execute(
      "UPDATE matchmaking_queue SET expiresAt = ? WHERE userId = ?",
      [expiresAt, user.id],
    );
  } else {
    const expiresAt = expiryFromNow(MATCHMAKING_QUEUE_TTL_MS);
    await conn.execute(
      `INSERT INTO matchmaking_queue
        (userId, opponentCount, targetScore, status, expiresAt)
       VALUES (?, ?, ?, 'searching', ?)`,
      [user.id, opponentCount, targetScore, expiresAt],
    );
  }

  const requiredPlayers = totalPlayersFor(opponentCount);
  const [candidateRows] = await conn.execute<QueueRow[]>(
    `SELECT *
     FROM matchmaking_queue
     WHERE status = 'searching'
       AND opponentCount = ?
       AND targetScore = ?
       AND expiresAt > CURRENT_TIMESTAMP
     ORDER BY createdAt ASC
     LIMIT ?
     FOR UPDATE`,
    [opponentCount, targetScore, requiredPlayers],
  );

  if (candidateRows.length < requiredPlayers) {
    const [currentRows] = await conn.execute<QueueRow[]>(
      "SELECT * FROM matchmaking_queue WHERE userId = ? LIMIT 1",
      [user.id],
    );
    const current = currentRows[0];
    if (!current) throw new Error("Antrean pertandingan tidak ditemukan.");
    return searchingResult(
      current,
      await matchingQueueCount(conn, opponentCount, targetScore),
    );
  }

  const roomCode = await createMatchedRoom(
    conn,
    candidateRows,
    opponentCount,
    targetScore,
  );
  const matchExpiry = expiryFromNow(MATCHMAKING_MATCH_TTL_MS);
  const ids = candidateRows.map((row) => Number(row.userId));
  const placeholders = ids.map(() => "?").join(", ");
  await conn.execute(
    `UPDATE matchmaking_queue
     SET status = 'matched', roomCode = ?, expiresAt = ?
     WHERE userId IN (${placeholders})`,
    [roomCode, matchExpiry, ...ids],
  );
  return { status: "matched", roomCode };
}

export async function enqueueMatchmaking(
  user: User,
  opponentCount: OnlineOpponentCount,
  targetScore: number,
): Promise<MatchmakingResult> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await queueOrMatch(conn, user, opponentCount, targetScore);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function getMatchmakingStatus(userId: number): Promise<MatchmakingResult> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await clearExpired(conn);
    const [rows] = await conn.execute<QueueRow[]>(
      "SELECT * FROM matchmaking_queue WHERE userId = ? FOR UPDATE",
      [userId],
    );
    const row = rows[0];
    if (!row) {
      await conn.commit();
      return { status: "idle" };
    }

    if (row.status === "matched" && row.roomCode) {
      const activeStatus = await getActiveRoomStatus(conn, row.roomCode);
      if (isActiveRoom(activeStatus)) {
        await conn.commit();
        return { status: "matched", roomCode: row.roomCode };
      }
      await conn.execute("DELETE FROM matchmaking_queue WHERE userId = ?", [userId]);
      await conn.commit();
      return { status: "idle" };
    }

    const expiresAt = expiryFromNow(MATCHMAKING_QUEUE_TTL_MS);
    await conn.execute(
      "UPDATE matchmaking_queue SET expiresAt = ? WHERE userId = ?",
      [expiresAt, userId],
    );
    const refreshed = { ...row, expiresAt };
    const result = searchingResult(
      refreshed,
      await matchingQueueCount(conn, row.opponentCount, row.targetScore),
    );
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function cancelMatchmaking(userId: number): Promise<MatchmakingResult> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<QueueRow[]>(
      "SELECT * FROM matchmaking_queue WHERE userId = ? FOR UPDATE",
      [userId],
    );
    const row = rows[0];
    if (row?.status === "matched" && row.roomCode) {
      const activeStatus = await getActiveRoomStatus(conn, row.roomCode);
      if (isActiveRoom(activeStatus)) {
        await conn.commit();
        return { status: "matched", roomCode: row.roomCode };
      }
    }
    await conn.execute("DELETE FROM matchmaking_queue WHERE userId = ?", [userId]);
    await conn.commit();
    return { status: "idle" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
