/**
 * Pelacak kehadiran in-memory — siapa yang sedang online di meja.
 *
 * Gateway WebSocket game menyentuh presence ketika subscribe, broadcast
 * snapshot, atau menerima pong heartbeat. Data ini ephemeral (tidak disimpan
 * ke DB) dan hanya dipakai untuk statistik live di landing.
 */

/**
 * Gateway mengirim ping WebSocket setiap 10 detik. TTL sengaja lebih longgar
 * dari satu interval agar lonjakan event loop singkat tidak membuat statistik
 * live berkedip menjadi offline.
 */
export const PRESENCE_TTL_MS = 30_000;

interface PlayerPresence {
  t: number;
  room: string;
}

export interface LiveRoomPresence {
  code: string;
  /** Pemain manusia dengan koneksi game aktif pada room ini. */
  playersOnline: number;
  lastActiveAt: number;
}

/** userId → kehadiran terakhir */
const players = new Map<string, PlayerPresence>();
/** kode room → waktu aktivitas terakhir */
const activeRooms = new Map<string, number>();

function sweep(now: number) {
  for (const [k, v] of players) {
    if (now - v.t > PRESENCE_TTL_MS) players.delete(k);
  }
  for (const [k, t] of activeRooms) {
    if (now - t > PRESENCE_TTL_MS) activeRooms.delete(k);
  }
}

/**
 * Catat aktivitas sebuah room.
 * `userKey` null untuk penonton — room tetap dihitung aktif, tetapi tidak
 * menambah hitungan pemain manusia online.
 */
export function touchRoomPresence(userKey: string | null, roomCode: string) {
  const now = Date.now();
  activeRooms.set(roomCode, now);
  if (userKey) players.set(userKey, { t: now, room: roomCode });
  // sapu berkala agar map tidak membengkak saat server hidup lama
  if (players.size + activeRooms.size > 500) sweep(now);
}

/** Hapus kehadiran pemain yang meninggalkan room tanpa memengaruhi room lain. */
export function clearPlayerRoomPresence(userKey: string, roomCode: string) {
  if (players.get(userKey)?.room === roomCode) players.delete(userKey);
}

/** Hapus seluruh state presence untuk room yang sudah tidak ada. */
export function clearRoomPresence(roomCode: string) {
  activeRooms.delete(roomCode);
  for (const [userKey, presence] of players) {
    if (presence.room === roomCode) players.delete(userKey);
  }
}

/**
 * Ringkasan room yang baru aktif untuk direktori meja di landing.
 *
 * Presence sengaja tetap ephemeral: jika server restart, room tidak dianggap
 * aktif sampai ada pemain/penonton yang benar-benar membuka koneksi lagi.
 */
export function getLiveRoomPresence(): LiveRoomPresence[] {
  sweep(Date.now());

  const playersByRoom = new Map<string, number>();
  for (const presence of players.values()) {
    playersByRoom.set(
      presence.room,
      (playersByRoom.get(presence.room) ?? 0) + 1
    );
  }

  return [...activeRooms.entries()]
    .map(([code, lastActiveAt]) => ({
      code,
      playersOnline: playersByRoom.get(code) ?? 0,
      lastActiveAt,
    }))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/** Statistik live untuk landing page. */
export function getLiveStats(): { playersOnline: number; activeRooms: number } {
  const rooms = getLiveRoomPresence();
  return {
    playersOnline: rooms.reduce((total, room) => total + room.playersOnline, 0),
    activeRooms: rooms.length,
  };
}
