import { describe, expect, it } from "vitest";
import {
  CARDS_PER_PLAYER,
  addPlayerToRoom,
  createRoomState,
  fullDeck,
  leavePlayerFromRoom,
  makePlayer,
  startRound,
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

  it("membiarkan kursi private kosong dan melewati gilirannya saat pemain keluar", () => {
    const state = createRoomState({
      hostUserId: 101,
      hostName: "Pemain Satu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 3,
      matchType: "private",
    });
    state.players.push(
      makePlayer({
        seat: 1,
        userId: 202,
        name: "Pemain Dua",
        avatar: null,
        isBot: false,
      }),
      makePlayer({
        seat: 2,
        userId: 303,
        name: "Pemain Tiga",
        avatar: null,
        isBot: false,
      }),
    );
    startRound(state);
    state.turnSeat = 1;

    expect(leavePlayerFromRoom(state, 202)).toEqual({
      didLeave: true,
      shouldDestroy: false,
    });

    expect(state.status).toBe("playing");
    expect(state.turnSeat).toBe(2);
    expect(state.players[1]).toMatchObject({
      seat: 1,
      userId: null,
      isBot: false,
      isVacant: true,
      inRound: false,
      hand: [],
    });
    const allCards = [
      ...state.stock,
      ...state.discard,
      ...state.players.flatMap((player) => player.hand),
    ].sort();
    expect(allCards).toEqual(fullDeck().sort());
  });

  it("membolehkan pemain baru mengisi kursi private aktif untuk sesi berikutnya", () => {
    const state = createRoomState({
      hostUserId: 101,
      hostName: "Pemain Satu",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: 3,
      matchType: "private",
    });
    state.players.push(
      makePlayer({
        seat: 1,
        userId: 202,
        name: "Pemain Dua",
        avatar: null,
        isBot: false,
      }),
      makePlayer({
        seat: 2,
        userId: 303,
        name: "Pemain Tiga",
        avatar: null,
        isBot: false,
      }),
    );
    startRound(state);
    leavePlayerFromRoom(state, 202);

    const joined = addPlayerToRoom(state, {
      userId: 404,
      name: "Pemain Empat",
      avatar: null,
      isBot: false,
    });

    expect(joined.joinsNextRound).toBe(true);
    expect(joined.player).toMatchObject({
      seat: 1,
      userId: 404,
      isVacant: false,
      inRound: false,
      hand: [],
    });

    startRound(state);

    expect(joined.player.inRound).toBe(true);
    expect(joined.player.hand).toHaveLength(CARDS_PER_PLAYER);
    expect(state.players.filter((player) => !player.isVacant)).toHaveLength(3);
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
