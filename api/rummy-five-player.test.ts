import { describe, expect, it } from "vitest";
import {
  CARDS_PER_PLAYER,
  DOUBLE_DECK_CARD_COUNT,
  MAX_ROOM_PLAYERS,
  createRoomState,
  deckForPlayerCount,
  isJoker,
  makePlayer,
  startRound,
} from "../contracts/rummy";

describe("room hingga delapan pemain", () => {
  it("memakai dua dek standar (104 kartu) dan membagikan tujuh kartu untuk setiap pemain", () => {
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
    expect(MAX_ROOM_PLAYERS).toBe(8);
    expect(
      state.players.every(player => player.hand.length === CARDS_PER_PLAYER)
    ).toBe(true);
    expect(state.stock).toHaveLength(
      DOUBLE_DECK_CARD_COUNT - MAX_ROOM_PLAYERS * CARDS_PER_PLAYER - 1
    );
    const dealtDeck = [
      ...state.stock,
      ...state.discard,
      ...state.players.flatMap(p => p.hand),
    ];
    expect(dealtDeck).toHaveLength(DOUBLE_DECK_CARD_COUNT);
    expect(new Set(dealtDeck)).toHaveLength(DOUBLE_DECK_CARD_COUNT);
    expect(dealtDeck.some(isJoker)).toBe(false);
    expect(dealtDeck.some(card => card.endsWith("~2"))).toBe(true);
    expect(deckForPlayerCount(MAX_ROOM_PLAYERS)).toHaveLength(
      DOUBLE_DECK_CARD_COUNT
    );
  });
});
