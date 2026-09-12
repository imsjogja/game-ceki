import { describe, expect, it } from "vitest";
import type { User } from "@db/schema";
import {
  createRoomState,
  makePlayer,
  sanitizeState,
  startRound,
  type GameState,
} from "@contracts/rummy";
import type {
  GameClientEvent,
  GameServerEvent,
} from "@contracts/game-realtime";
import {
  GameRealtimeHub,
  nextGameWakeAt,
  type GameAuthorizer,
  type GameSnapshot,
  type GameTransport,
} from "./game-router";

class FakeTransport implements GameTransport {
  readonly events: GameServerEvent[] = [];
  readonly closes: { code?: number; reason?: string }[] = [];

  send(event: GameServerEvent): void {
    this.events.push(event);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
}

function user(id: number): User {
  return { id } as User;
}

function subscribe(): GameClientEvent {
  return { type: "subscribe", code: "ABC234" };
}

function roomState(): GameState {
  const state = createRoomState({
    hostUserId: 1,
    hostName: "Pemain Satu",
    hostAvatar: null,
    targetScore: 250,
    maxPlayers: 2,
    matchType: "stranger",
  });
  state.players.push(
    makePlayer({
      seat: 1,
      userId: 2,
      name: "Pemain Dua",
      avatar: null,
      isBot: false,
    })
  );
  startRound(state);
  return state;
}

function snapshotFor(state: GameState, currentUser: User | null): GameSnapshot {
  return {
    code: "ABC234",
    version: 7,
    room: {
      name: "Meja Uji",
      state: sanitizeState(state, currentUser?.id ?? null),
    },
    playerUserId: currentUser?.id ?? null,
  };
}

function snapshots(transport: FakeTransport) {
  return transport.events.filter(
    (event): event is Extract<GameServerEvent, { type: "snapshot" }> =>
      event.type === "snapshot"
  );
}

describe("GameRealtimeHub", () => {
  it("mengirim snapshot yang tersanitasi per penerima", async () => {
    const state = roomState();
    const authorize: GameAuthorizer = async currentUser =>
      snapshotFor(state, currentUser);
    const hub = new GameRealtimeHub(authorize);
    const first = new FakeTransport();
    const second = new FakeTransport();

    await hub.receive(first, user(1), subscribe());
    await hub.receive(second, user(2), subscribe());

    const firstState = snapshots(first)[0]?.room.state;
    const secondState = snapshots(second)[0]?.room.state;
    expect(firstState?.players[0].hand).toHaveLength(7);
    expect(firstState?.players[1].hand).toBeUndefined();
    expect(secondState?.players[1].hand).toHaveLength(7);
    expect(secondState?.players[0].hand).toBeUndefined();
  });

  it("baru menjadwalkan disconnect setelah socket terakhir pemain putus", async () => {
    const state = roomState();
    const disconnected: [string, number][] = [];
    const hub = new GameRealtimeHub(
      async currentUser => snapshotFor(state, currentUser),
      () => {},
      (code, userId) => disconnected.push([code, userId])
    );
    const firstTab = new FakeTransport();
    const secondTab = new FakeTransport();

    await hub.receive(firstTab, user(1), subscribe());
    await hub.receive(secondTab, user(1), subscribe());
    hub.disconnect(firstTab);
    expect(disconnected).toEqual([]);

    hub.disconnect(secondTab);
    expect(disconnected).toEqual([["ABC234", 1]]);
  });

  it("tidak memperlakukan penonton private sebagai peserta yang harus dibersihkan", async () => {
    const state = roomState();
    const disconnected: [string, number][] = [];
    const hub = new GameRealtimeHub(
      async currentUser => ({
        ...snapshotFor(state, currentUser),
        playerUserId: null,
      }),
      () => {},
      (code, userId) => disconnected.push([code, userId])
    );
    const spectator = new FakeTransport();

    await hub.receive(spectator, user(77), subscribe());
    hub.disconnect(spectator);

    expect(disconnected).toEqual([]);
  });

  it("mempromosikan socket penonton yang kemudian menjadi pemain", async () => {
    const state = roomState();
    let joined = false;
    const connected: [string, number][] = [];
    const disconnected: [string, number][] = [];
    const hub = new GameRealtimeHub(
      async currentUser => ({
        ...snapshotFor(state, currentUser),
        playerUserId: joined ? (currentUser?.id ?? null) : null,
      }),
      (code, userId) => connected.push([code, userId]),
      (code, userId) => disconnected.push([code, userId])
    );
    const spectator = new FakeTransport();

    await hub.receive(spectator, user(2), subscribe());
    expect(connected).toEqual([]);

    // Re-subscribe memakai jalur reconciler yang juga dipakai publishRoom
    // setelah mutasi rummy.join selesai tersimpan.
    joined = true;
    await hub.receive(spectator, user(2), subscribe());
    expect(connected).toEqual([["ABC234", 2]]);

    hub.disconnect(spectator);
    expect(disconnected).toEqual([["ABC234", 2]]);
  });

  it("membaca ulang snapshot setelah enrollment agar mutasi yang berpacu tidak hilang", async () => {
    const state = roomState();
    let reads = 0;
    const hub = new GameRealtimeHub(async currentUser => ({
      ...snapshotFor(state, currentUser),
      // Simulasikan mutasi room tepat sesudah read awal, sebelum socket
      // berhasil terdaftar sebagai subscriber hub.
      version: ++reads === 1 ? 7 : 8,
    }));
    const transport = new FakeTransport();

    await hub.receive(transport, user(1), subscribe());

    expect(snapshots(transport)).toHaveLength(1);
    expect(snapshots(transport)[0]?.version).toBe(8);
  });
});

describe("nextGameWakeAt", () => {
  it("menjadwalkan bot segera atau sesuai delay, dan manusia pada timeout gilirannya", () => {
    const state = roomState();
    const now = 1_000_000;
    state.turnSeat = 0;
    state.turnStartedAt = now - 1_000;
    expect(nextGameWakeAt(state, now)).toBe(state.turnStartedAt + 75_000);

    state.players[0].isBot = true;
    state.botActionAt = now + 1_100;
    expect(nextGameWakeAt(state, now)).toBe(now + 1_100);

    state.botActionAt = 0;
    expect(nextGameWakeAt(state, now)).toBe(now);
  });
});
