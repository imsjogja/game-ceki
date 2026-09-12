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

import { getMatchmakingStatus } from "./matchmaking";

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
