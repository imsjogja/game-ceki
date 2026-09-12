import { describe, expect, it } from "vitest";
import {
  createRoomState,
  leavePlayerFromRoom,
  makePlayer,
} from "@contracts/rummy";

describe("room lifecycle", () => {
  it("menghapus room lobby ketika manusia terakhir keluar walau masih ada bot", () => {
    const state = createRoomState({
      hostUserId: 101,
      hostName: "Tamu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 2,
      matchType: "bot",
    });
    state.players.push(
      makePlayer({
        seat: 1,
        userId: null,
        name: "Bot Kartini",
        avatar: null,
        isBot: true,
      })
    );

    expect(leavePlayerFromRoom(state, 101)).toEqual({
      didLeave: true,
      shouldDestroy: true,
    });
    expect(state.players).toHaveLength(1);
    expect(state.players[0]).toMatchObject({ isBot: true, seat: 0 });
  });

  it("menghapus room game yang sudah selesai ketika manusia terakhir keluar", () => {
    const state = createRoomState({
      hostUserId: 101,
      hostName: "Tamu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 2,
      matchType: "bot",
    });
    state.players.push(
      makePlayer({
        seat: 1,
        userId: null,
        name: "Bot Kartini",
        avatar: null,
        isBot: true,
      }),
    );
    state.status = "finished";

    expect(leavePlayerFromRoom(state, 101)).toEqual({
      didLeave: true,
      shouldDestroy: true,
    });
  });

  it("mempertahankan room permainan bila masih ada manusia lain", () => {
    const state = createRoomState({
      hostUserId: 101,
      hostName: "Pemain Satu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 2,
      matchType: "stranger",
    });
    state.players.push(
      makePlayer({
        seat: 1,
        userId: 202,
        name: "Pemain Dua",
        avatar: null,
        isBot: false,
      })
    );
    state.status = "playing";

    expect(leavePlayerFromRoom(state, 101)).toEqual({
      didLeave: true,
      shouldDestroy: false,
    });
    expect(state.players[0]).toMatchObject({
      userId: null,
      isBot: true,
      connected: false,
    });
    expect(state.players[1]).toMatchObject({ userId: 202, isBot: false });
    expect(state.hostSeat).toBe(1);
  });

  it("menandai room pertandingan untuk dimusnahkan setelah manusia terakhir keluar", () => {
    const state = createRoomState({
      hostUserId: 101,
      hostName: "Pemain Satu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 2,
      matchType: "stranger",
    });
    state.players.push(
      makePlayer({
        seat: 1,
        userId: 202,
        name: "Pemain Dua",
        avatar: null,
        isBot: false,
      })
    );
    state.status = "playing";

    leavePlayerFromRoom(state, 101);

    expect(leavePlayerFromRoom(state, 202)).toEqual({
      didLeave: true,
      shouldDestroy: true,
    });
    expect(state.players.every(player => player.isBot)).toBe(true);
  });
});
