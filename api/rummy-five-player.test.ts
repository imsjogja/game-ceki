import { describe, expect, it } from "vitest";
import {
  CARDS_PER_PLAYER,
  MAX_ROOM_PLAYERS,
  createRoomState,
  fullDeck,
  makePlayer,
  startRound,
} from "../contracts/rummy";

describe("room lima pemain", () => {
  it("membagikan tujuh kartu kepada setiap pemain tanpa mengurangi integritas dek", () => {
    const state = createRoomState({
      hostUserId: 1,
      hostName: "Pemain 1",
      hostAvatar: null,
      targetScore: 250,
      maxPlayers: MAX_ROOM_PLAYERS,
    });

    for (let seat = 1; seat < MAX_ROOM_PLAYERS; seat++) {
      state.players.push(
        makePlayer({
          seat,
          userId: seat + 1,
          name: `Pemain ${seat + 1}`,
          avatar: null,
          isBot: false,
        })
      );
    }

    startRound(state);

    expect(state.players).toHaveLength(MAX_ROOM_PLAYERS);
    expect(
      state.players.every(player => player.hand.length === CARDS_PER_PLAYER)
    ).toBe(true);
    expect(state.stock).toHaveLength(
      fullDeck().length - MAX_ROOM_PLAYERS * CARDS_PER_PLAYER - 1
    );
    expect(
      new Set([
        ...state.stock,
        ...state.discard,
        ...state.players.flatMap(p => p.hand),
      ]).size
    ).toBe(fullDeck().length);
  });
});
