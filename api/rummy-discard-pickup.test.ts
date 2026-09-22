import { describe, expect, it } from "vitest";
import {
  discardCard,
  drawCard,
  meldCards,
  makePlayer,
  createRoomState,
  sanitizeState,
  type CardCode,
  type GameState,
} from "../contracts/rummy";

function stateForTurn(hand: CardCode[], discard: CardCode[]): GameState {
  const state = createRoomState({
    hostUserId: 1,
    hostName: "Pemain 1",
    hostAvatar: null,
    targetScore: 250,
    maxPlayers: 2,
  });
  state.players.push(
    makePlayer({
      seat: 1,
      userId: 2,
      name: "Pemain 2",
      avatar: null,
      isBot: false,
    })
  );
  state.status = "playing";
  state.phase = "draw";
  state.round = 1;
  state.turnSeat = 0;
  state.players[0].hand = [...hand];
  state.players[1].hand = ["2D", "3D", "4D", "5D", "6D", "7D", "8D"];
  state.discard = [...discard];
  state.stock = ["AS"];
  return state;
}

describe("aturan ambil buangan", () => {
  it("mengizinkan target buangan dibuang setelah membuka kombinasi lain", () => {
    const state = stateForTurn(
      ["3S", "4S", "5S", "7H", "8H", "9H", "KD"],
      ["2S"]
    );

    drawCard(state, 1, "discard", 0);
    expect(state.discardPickup).toMatchObject({
      target: "2S",
      depth: 0,
      cardsTaken: 1,
      openedCards: 0,
    });

    meldCards(state, 1, ["3S", "4S", "5S"]);
    expect(state.discardPickup).toMatchObject({
      openedCards: 3,
    });

    discardCard(state, 1, "2S");
    expect(state.players[0].hand).toHaveLength(4);
    expect(state.discardPickup).toBeNull();
  });

  it("mewajibkan total kartu yang dibuka minimal sebesar kedalaman ambilan", () => {
    const state = stateForTurn(
      ["3S", "4S", "7H", "8H", "9H", "KD", "QC"],
      ["5S", "2C", "6D", "TH", "JC"]
    );

    // Target 5S berada pada kedalaman 4, sehingga lima kartu diambil.
    drawCard(state, 1, "discard", 4);
    meldCards(state, 1, ["3S", "4S", "5S"]);

    const handBeforeFailedDiscard = [...state.players[0].hand];
    expect(() => discardCard(state, 1, "KD")).toThrow(/minimal 4 kartu/i);
    expect(state.players[0].hand).toEqual(handBeforeFailedDiscard);

    meldCards(state, 1, ["7H", "8H", "9H"]);
    discardCard(state, 1, "KD");
    expect(state.players[0].hand.length).toBeLessThanOrEqual(7);
  });

  it("menolak ambilan buangan yang tidak mungkin memenuhi kewajiban", () => {
    const state = stateForTurn(
      ["3S", "4S", "7H", "9D", "TC", "QD", "AD"],
      ["5S", "2C", "6D", "TH", "JC"]
    );
    const handBefore = [...state.players[0].hand];
    const discardBefore = [...state.discard];

    expect(() => drawCard(state, 1, "discard", 4)).toThrow(
      /tidak bisa diselesaikan/i
    );
    expect(state.players[0].hand).toEqual(handBefore);
    expect(state.discard).toEqual(discardBefore);
    expect(state.phase).toBe("draw");
  });

  it("tidak menerapkan kewajiban pada kartu yang diambil dari deck", () => {
    const state = stateForTurn(
      ["3S", "4S", "7H", "8H", "9H", "KD", "QC"],
      ["5S"]
    );

    drawCard(state, 1, "stock", 0);
    expect(state.discardPickup).toBeNull();
    discardCard(state, 1, "KD");
    expect(state.players[0].hand).toHaveLength(7);
  });

  it("hanya mengirim metadata ambil buangan kepada pemain yang sedang giliran", () => {
    const state = stateForTurn(
      ["3S", "4S", "7H", "8H", "9H", "KD", "QC"],
      ["5S"]
    );
    drawCard(state, 1, "discard", 0);

    expect(sanitizeState(state, 1).discardPickup).toMatchObject({
      target: "5S",
    });
    expect(sanitizeState(state, 2).discardPickup).toBeNull();
  });
});
