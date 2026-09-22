import { describe, expect, it } from "vitest";
import {
  opponentsStillNeeded,
  totalPlayersFor,
} from "@contracts/matchmaking";

describe("matchmaking contract", () => {
  it("menghitung jumlah pemain untuk setiap pilihan lawan", () => {
    expect(totalPlayersFor(1)).toBe(2);
    expect(totalPlayersFor(2)).toBe(3);
    expect(totalPlayersFor(3)).toBe(4);
    expect(totalPlayersFor(4)).toBe(5);
  });

  it("tidak pernah mengembalikan kebutuhan lawan negatif", () => {
    expect(opponentsStillNeeded(3, 1)).toBe(3);
    expect(opponentsStillNeeded(3, 3)).toBe(1);
    expect(opponentsStillNeeded(3, 4)).toBe(0);
    expect(opponentsStillNeeded(4, 1)).toBe(4);
    expect(opponentsStillNeeded(4, 5)).toBe(0);
    expect(opponentsStillNeeded(1, 8)).toBe(0);
  });
});
