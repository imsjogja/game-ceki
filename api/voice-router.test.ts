import { describe, expect, it } from "vitest";
import type { User } from "@db/schema";
import type {
  VoiceClientEvent,
  VoiceIceServer,
  VoiceServerEvent,
} from "@contracts/voice";
import {
  VoiceSignalingHub,
  type VoiceAuthorizer,
  type VoiceTransport,
} from "./voice-router";

class FakeTransport implements VoiceTransport {
  readonly events: VoiceServerEvent[] = [];
  readonly closes: { code?: number; reason?: string }[] = [];

  send(event: VoiceServerEvent): void {
    this.events.push(event);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
}

const ICE_SERVERS: VoiceIceServer[] = [{ urls: ["stun:example.test:3478"] }];

function user(id: number): User {
  return { id } as User;
}

function join(peerId: string): VoiceClientEvent {
  return { type: "join", code: "ABC234", peerId };
}

function makeHub(allowedUserIds = new Set([1, 2, 3])): VoiceSignalingHub {
  const authorize: VoiceAuthorizer = async (member, roomCode) => {
    if (roomCode !== "ABC234" || !allowedUserIds.has(member.id)) {
      throw new Error("not a player");
    }
    return {
      userId: member.id,
      name: `Pemain ${member.id}`,
      avatar: null,
      seat: member.id - 1,
      iceServers: ICE_SERVERS,
    };
  };
  return new VoiceSignalingHub(authorize);
}

function eventsOfType<T extends VoiceServerEvent["type"]>(
  transport: FakeTransport,
  type: T
): Extract<VoiceServerEvent, { type: T }>[] {
  return transport.events.filter(
    (event): event is Extract<VoiceServerEvent, { type: T }> =>
      event.type === type
  );
}

describe("VoiceSignalingHub", () => {
  it("mengirim ready lalu event peer join/leave untuk anggota room", async () => {
    const hub = makeHub();
    const first = new FakeTransport();
    const second = new FakeTransport();

    await hub.receive(first, user(1), join("peer-one"));
    await hub.receive(second, user(2), join("peer-two"));

    expect(eventsOfType(first, "ready")[0]).toMatchObject({
      peers: [],
      iceServers: ICE_SERVERS,
    });
    expect(eventsOfType(second, "ready")[0]?.peers).toEqual([
      expect.objectContaining({ peerId: "peer-one", name: "Pemain 1" }),
    ]);
    expect(eventsOfType(first, "peer-joined")).toEqual([
      expect.objectContaining({
        peer: expect.objectContaining({ peerId: "peer-two" }),
      }),
    ]);

    await hub.receive(second, user(2), { type: "leave" });
    expect(eventsOfType(first, "peer-left")).toEqual([
      expect.objectContaining({ peerId: "peer-two" }),
    ]);
  });

  it("meneruskan signaling hanya kepada target yang ada di room sama", async () => {
    const hub = makeHub();
    const sender = new FakeTransport();
    const receiver = new FakeTransport();
    const other = new FakeTransport();

    await hub.receive(sender, user(1), join("peer-one"));
    await hub.receive(receiver, user(2), join("peer-two"));
    await hub.receive(other, user(3), join("peer-three"));
    sender.events.length = 0;
    receiver.events.length = 0;
    other.events.length = 0;

    await hub.receive(sender, user(1), {
      type: "signal",
      to: "peer-two",
      data: {
        kind: "sdp",
        description: { type: "offer", sdp: "test-sdp" },
      },
    });

    expect(eventsOfType(receiver, "signal")).toEqual([
      expect.objectContaining({
        from: "peer-one",
        data: expect.objectContaining({ kind: "sdp" }),
      }),
    ]);
    expect(eventsOfType(sender, "signal")).toHaveLength(0);
    expect(eventsOfType(other, "signal")).toHaveLength(0);
  });

  it("menolak signaling sebelum transport bergabung", async () => {
    const hub = makeHub();
    const sender = new FakeTransport();

    await hub.receive(sender, user(1), {
      type: "signal",
      to: "peer-two",
      data: { kind: "ice", candidate: null },
    });

    expect(eventsOfType(sender, "error")).toEqual([
      expect.objectContaining({ code: "invalid-state" }),
    ]);
  });

  it("mengganti sesi lama untuk akun yang sama agar dua tab tidak loopback", async () => {
    const hub = makeHub();
    const oldTab = new FakeTransport();
    const observer = new FakeTransport();
    const newTab = new FakeTransport();

    await hub.receive(oldTab, user(1), join("peer-old"));
    await hub.receive(observer, user(2), join("peer-observer"));
    oldTab.events.length = 0;
    observer.events.length = 0;

    await hub.receive(newTab, user(1), join("peer-new"));

    expect(oldTab.closes).toEqual([
      { code: 4000, reason: "replaced-by-new-session" },
    ]);
    expect(eventsOfType(observer, "peer-left")).toEqual([
      expect.objectContaining({ peerId: "peer-old" }),
    ]);
    expect(eventsOfType(observer, "peer-joined")).toEqual([
      expect.objectContaining({
        peer: expect.objectContaining({ peerId: "peer-new" }),
      }),
    ]);
  });

  it("menutup seluruh socket ketika room permainan dihancurkan", async () => {
    const hub = makeHub();
    const first = new FakeTransport();
    const second = new FakeTransport();

    await hub.receive(first, user(1), join("peer-one"));
    await hub.receive(second, user(2), join("peer-two"));
    hub.destroyRoom("ABC234");

    expect(first.closes).toEqual([{ code: 4001, reason: "room-closed" }]);
    expect(second.closes).toEqual([{ code: 4001, reason: "room-closed" }]);
    expect(eventsOfType(first, "error")).toEqual([
      expect.objectContaining({ code: "room-closed" }),
    ]);
    expect(eventsOfType(second, "error")).toEqual([
      expect.objectContaining({ code: "room-closed" }),
    ]);
  });

  it("menutup voice pemain yang keluar atau dikeluarkan dari room", async () => {
    const hub = makeHub();
    const removed = new FakeTransport();
    const observer = new FakeTransport();

    await hub.receive(removed, user(1), join("peer-removed"));
    await hub.receive(observer, user(2), join("peer-observer"));
    removed.events.length = 0;
    observer.events.length = 0;

    hub.disconnectUser("ABC234", 1);

    expect(removed.closes).toEqual([
      { code: 4003, reason: "no-longer-room-member" },
    ]);
    expect(eventsOfType(removed, "error")).toEqual([
      expect.objectContaining({ code: "forbidden" }),
    ]);
    expect(eventsOfType(observer, "peer-left")).toEqual([
      expect.objectContaining({ peerId: "peer-removed" }),
    ]);
  });

  it("menolak user yang tidak diotorisasi untuk room", async () => {
    const hub = makeHub(new Set([1]));
    const outsider = new FakeTransport();

    await hub.receive(outsider, user(2), join("peer-outsider"));

    expect(eventsOfType(outsider, "error")).toEqual([
      expect.objectContaining({ code: "forbidden" }),
    ]);
  });
});
