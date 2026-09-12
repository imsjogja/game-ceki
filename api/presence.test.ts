import { describe, it, expect, vi, afterEach } from "vitest";
import {
  clearPlayerRoomPresence,
  clearRoomPresence,
  getLiveRoomPresence,
  getLiveStats,
  PRESENCE_TTL_MS,
  touchRoomPresence,
} from "./presence";

afterEach(() => {
  vi.useRealTimers();
});

describe("presence / liveStats", () => {
  it("menghitung pemain online dan room aktif", () => {
    const t0 = Date.now() + 1_000_000; // lompatan waktu agar terisolasi
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    touchRoomPresence("u1", "ABC234");
    touchRoomPresence("u2", "ABC234");
    touchRoomPresence("u3", "XYZ789");
    touchRoomPresence(null, "XYZ789"); // penonton anon: room aktif, bukan pemain

    const s = getLiveStats();
    expect(s.playersOnline).toBe(3);
    expect(s.activeRooms).toBe(2);
  });

  it("kedaluwarsa setelah TTL tanpa aktivitas", () => {
    const t0 = Date.now() + 2_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    touchRoomPresence("u9", "ROOM99");
    expect(getLiveStats()).toEqual({ playersOnline: 1, activeRooms: 1 });

    vi.setSystemTime(t0 + PRESENCE_TTL_MS + 1);
    expect(getLiveStats()).toEqual({ playersOnline: 0, activeRooms: 0 });
  });

  it("sentuhan ulang memperpanjang kehadiran", () => {
    const t0 = Date.now() + 3_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    touchRoomPresence("u5", "ROOM55");
    vi.setSystemTime(t0 + PRESENCE_TTL_MS - 2_000);
    touchRoomPresence("u5", "ROOM55"); // poll berikutnya
    vi.setSystemTime(t0 + PRESENCE_TTL_MS + 1_000);

    const s = getLiveStats();
    expect(s.playersOnline).toBe(1);
    expect(s.activeRooms).toBe(1);
  });

  it("membersihkan pemain dan room yang sudah dimusnahkan", () => {
    const t0 = Date.now() + 4_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    touchRoomPresence("u10", "OLD111");
    touchRoomPresence("u11", "OLD111");
    touchRoomPresence("u12", "LIVE22");
    clearPlayerRoomPresence("u10", "OLD111");
    expect(getLiveStats()).toEqual({ playersOnline: 2, activeRooms: 2 });

    clearRoomPresence("OLD111");
    expect(getLiveStats()).toEqual({ playersOnline: 1, activeRooms: 1 });
  });

  it("mengelompokkan jumlah pemain aktif untuk setiap room", () => {
    const t0 = Date.now() + 5_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    touchRoomPresence("u1", "OLD111");
    touchRoomPresence("u2", "OLD111");
    vi.setSystemTime(t0 + 1_000);
    touchRoomPresence("u3", "LIVE22");

    expect(getLiveRoomPresence()).toEqual([
      {
        code: "LIVE22",
        playersOnline: 1,
        lastActiveAt: t0 + 1_000,
      },
      {
        code: "OLD111",
        playersOnline: 2,
        lastActiveAt: t0,
      },
    ]);
  });
});
