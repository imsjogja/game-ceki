import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute: vi.fn(),
  };
  const pool = {
    getConnection: vi.fn().mockResolvedValue(connection),
  };
  return {
    connection,
    createPool: vi.fn(() => pool),
  };
});

vi.mock("mysql2/promise", () => ({
  default: { createPool: mocks.createPool },
}));

import { enqueueMatchmaking, getMatchmakingStatus } from "./matchmaking";

const matchedTicket = {
  userId: 101,
  opponentCount: 1,
  targetScore: 250,
  status: "matched",
  roomCode: "OLD111",
  createdAt: new Date("2026-09-12T12:00:00Z"),
  expiresAt: new Date("2026-09-12T13:00:00Z"),
};

describe("getMatchmakingStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.beginTransaction.mockResolvedValue(undefined);
    mocks.connection.commit.mockResolvedValue(undefined);
    mocks.connection.rollback.mockResolvedValue(undefined);
    mocks.connection.release.mockReturnValue(undefined);
  });

  it("membuang tiket matched lama jika pemain sudah tidak ada di room", async () => {
    mocks.connection.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM matchmaking_queue")) {
        return [[matchedTicket]];
      }
      if (sql.startsWith("SELECT status, state FROM rooms")) {
        return [
          [
            {
              status: "playing",
              state: JSON.stringify({
                players: [{ userId: null, isBot: true }],
              }),
            },
          ],
        ];
      }
      return [[]];
    });

    await expect(getMatchmakingStatus(101)).resolves.toEqual({
      status: "idle",
    });
    expect(mocks.connection.execute).toHaveBeenCalledWith(
      "DELETE FROM matchmaking_queue WHERE userId = ?",
      [101]
    );
  });

  it("mempertahankan tiket matched ketika pemain masih berada di room aktif", async () => {
    mocks.connection.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT * FROM matchmaking_queue")) {
        return [[matchedTicket]];
      }
      if (sql.startsWith("SELECT status, state FROM rooms")) {
        return [
          [
            {
              status: "playing",
              state: JSON.stringify({
                players: [{ userId: 101, isBot: false }],
              }),
            },
          ],
        ];
      }
      return [[]];
    });

    await expect(getMatchmakingStatus(101)).resolves.toEqual({
      status: "matched",
      roomCode: "OLD111",
    });
    expect(mocks.connection.execute).not.toHaveBeenCalledWith(
      "DELETE FROM matchmaking_queue WHERE userId = ?",
      [101]
    );
  });
});

describe("enqueueMatchmaking", () => {
  it("menggantikan tiket matched stale dengan tiket searching baru", async () => {
    let ticket:
      | (Omit<typeof matchedTicket, "roomCode"> & { roomCode: string | null })
      | undefined = matchedTicket;
    const staleRoom = {
      status: "playing",
      state: JSON.stringify({
        players: [{ userId: null, isBot: true }],
      }),
    };

    mocks.connection.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE FROM matchmaking_queue WHERE expiresAt")) {
        return [[]];
      }
      if (sql.includes("WHERE userId = ? FOR UPDATE")) {
        return [ticket ? [ticket] : []];
      }
      if (sql.startsWith("SELECT status, state FROM rooms")) {
        return [[staleRoom]];
      }
      if (sql.startsWith("DELETE FROM matchmaking_queue WHERE userId = ?")) {
        ticket = undefined;
        return [[]];
      }
      if (sql.includes("INSERT INTO matchmaking_queue")) {
        ticket = {
          ...matchedTicket,
          opponentCount: 1,
          targetScore: 250,
          status: "searching",
          roomCode: null,
          expiresAt: new Date("2026-09-12T13:01:30Z"),
        };
        return [[]];
      }
      if (sql.includes("FROM matchmaking_queue") && sql.includes("LIMIT ?")) {
        return [[ticket]];
      }
      if (sql.includes("WHERE userId = ? LIMIT 1")) {
        return [ticket ? [ticket] : []];
      }
      if (sql.includes("COUNT(*) AS queuedPlayers")) {
        return [[{ queuedPlayers: 1 }]];
      }
      return [[]];
    });

    await expect(
      enqueueMatchmaking(
        { id: 101, name: "Tamu", avatar: null } as never,
        1,
        250,
      ),
    ).resolves.toMatchObject({
      status: "searching",
      opponentCount: 1,
      targetScore: 250,
      queuedPlayers: 1,
      opponentsNeeded: 1,
    });
    expect(mocks.connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO matchmaking_queue"),
      [101, 1, 250, expect.any(Date)],
    );
  });
});
