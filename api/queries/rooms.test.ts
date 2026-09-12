import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Room } from "@db/schema";
import { createRoomState } from "@contracts/rummy";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("./connection", () => ({
  getDb: mocks.getDb,
}));

import {
  getRoomsByCodes,
  withRoomAndDestroyIf,
  withRoomIfChanged,
} from "./rooms";

describe("getRoomsByCodes", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  it("tidak mengakses database bila daftar kode room kosong", async () => {
    await expect(getRoomsByCodes([])).resolves.toEqual([]);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("mengambil daftar room sekaligus dalam satu query", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    mocks.getDb.mockReturnValue({
      query: { rooms: { findMany } },
    });

    await getRoomsByCodes(["ABC234", "XYZ789", "ABC234"]);

    expect(findMany).toHaveBeenCalledOnce();
  });
});

describe("withRoomAndDestroyIf", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  it("menghapus room dengan optimistic-lock ketika predikat lifecycle terpenuhi", async () => {
    const state = createRoomState({
      hostUserId: 7,
      hostName: "Tamu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 2,
    });
    const room = {
      code: "ABC234",
      state,
      version: 9,
    } as Room;
    const findFirst = vi.fn().mockResolvedValue(room);
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const remove = vi.fn().mockReturnValue({ where });
    const update = vi.fn();

    mocks.getDb.mockReturnValue({
      query: { rooms: { findFirst } },
      delete: remove,
      update,
    });

    const outcome = await withRoomAndDestroyIf(
      room.code,
      currentState => {
        currentState.players = [];
        return { shouldDestroy: true };
      },
      (_state, _room, result) => result.shouldDestroy
    );

    expect(outcome).toEqual({
      result: { shouldDestroy: true },
      destroyed: true,
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("withRoomIfChanged", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
  });

  it("tidak menaikkan versi room bila polling tidak mengubah state", async () => {
    const state = createRoomState({
      hostUserId: 7,
      hostName: "Tamu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 2,
    });
    const room = {
      code: "ABC234",
      state,
      version: 9,
    } as Room;
    const findFirst = vi.fn().mockResolvedValue(room);
    const update = vi.fn();

    mocks.getDb.mockReturnValue({
      query: { rooms: { findFirst } },
      update,
    });

    await expect(
      withRoomIfChanged(room.code, (currentState) => ({
        changed: false,
        result: currentState.status,
      })),
    ).resolves.toBe("waiting");

    expect(update).not.toHaveBeenCalled();
  });
});
