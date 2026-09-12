/**
 * Pelacak kehadiran in-memory — siapa yang sedang online di meja.
 *
 * Permainan mem-poll `rummy.get` tiap ~1,2 detik dari lobby & meja, jadi
 * setiap poll sekaligus menjadi sinyal "masih di sini". Data ini ephemeral
 * (tidak disimpan ke DB) dan hanya dipakai untuk statistik live di landing.
 */

/** Dianggap online jika terlihat dalam 12 detik terakhir (poll tiap 1,2 dtk). */
export const PRESENCE_TTL_MS = 12_000;

interface PlayerPresence {
  t: number;
  room: string;
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
 * Catat aktivitas sebuah room (dipanggil dari rummy.get).
 * `userKey` null untuk penonton yang belum masuk — room tetap dihitung aktif.
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

/** Statistik live untuk landing page. */
export function getLiveStats(): { playersOnline: number; activeRooms: number } {
  sweep(Date.now());
  return { playersOnline: players.size, activeRooms: activeRooms.size };
}
