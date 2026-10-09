import { describe, expect, it } from "vitest";
import {
  createRoomState,
  discardCard,
  findMelds,
  makePlayer,
  meldCards,
  validateMeld,
  type CardCode,
  type GameState,
} from "../contracts/rummy";

function stateForPlay(hand: CardCode[]): GameState {
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
  state.phase = "play";
  state.round = 1;
  state.turnSeat = 0;
  state.players[0].hand = [...hand];
  state.players[1].hand = ["2D", "3D", "4D", "5D", "6D", "7D", "8D"];
  state.stock = ["AS"];
  return state;
}

describe("aturan seri dan tutup tangan", () => {
  it("hanya menerima seri linear dari 2 sampai K dan tidak memakai As", () => {
    expect(validateMeld(["2S", "3S", "4S"], false)).not.toBeNull();
    expect(validateMeld(["JS", "QS", "KS"], false)).not.toBeNull();
    expect(validateMeld(["AS", "2S", "3S"], true)).toBeNull();
    expect(validateMeld(["QS", "KS", "AS"], true)).toBeNull();
    expect(validateMeld(["KS", "AS", "2S"], true)).toBeNull();

    expect(validateMeld(["AS", "AH", "AD"], true)).not.toBeNull();
    expect(findMelds(["AS", "2S", "3S", "QS", "KS"], true)).not.toContainEqual([
      "AS",
      "2S",
      "3S",
    ]);
  });

  it("melarang membuka semua kartu karena satu kartu harus tersisa untuk tutup", () => {
    const state = stateForPlay(["3S", "4S", "5S"]);

    expect(() => meldCards(state, 1, ["3S", "4S", "5S"])).toThrow(
      /sisakan satu kartu/i
    );
    expect(state.players[0].hand).toEqual(["3S", "4S", "5S"]);
    expect(state.melds).toHaveLength(0);
    expect(state.status).toBe("playing");
  });

  it("membatalkan kewajiban buka yang sudah mustahil agar giliran tidak macet", () => {
    const state = stateForPlay(["KD", "QC"]);
    state.discardPickup = {
      target: "5S",
      depth: 1,
      cardsTaken: 2,
      openedCards: 0,
    };

    discardCard(state, 1, "KD");

    expect(state.discardPickup).toBeNull();
    expect(state.players[0].hand).toEqual(["QC"]);
    expect(state.turnSeat).toBe(1);
    expect(state.phase).toBe("draw");
  });
});
