// ═══════════════════════════════════════════════════════════════════
// REMI INDONESIA (CEKI) — mesin permainan bersama server & klien.
// Merujuk makalah "Strategi Greedy pada Permainan Kartu Remi"
// (IF2211 Strategi Algoritma, ITB, 2020/2021):
//  • 2–4 pemain: 52 kartu + 2 joker; 5–8 pemain: dua dek standar (104 kartu)
//  • Nilai: 2–10 = 5 poin, J/Q/K = 10, As = 15, Joker = nilai kartu yang diwakili
//  • Kartu jadi (di meja) = poin PLUS; sisa kartu tangan = poin MINUS
//  • Tutupan (kombinasi) pertama tiap pemain WAJIB seri (urutan sejenis) & tanpa joker
//  • As melingkar: K-A-2 dan A-2-3 sama-sama sah
//  • Tidak ada layoff — kartu tidak bisa ditempel ke kombinasi yang sudah di meja
//  • Ambil buangan: hanya 7 kartu teratas; kartu target + minimal 2 kartu tangan
//    harus menjadi kombinasi jadi; semua kartu di atasnya ikut terambil
//  • Setelah ambil buangan, kartu target wajib dibuka pada giliran yang sama.
//    Sesudah membuang satu kartu, sisa tangan maksimal 7 kartu.
//  • Joker: tak boleh di tutupan pertama; membuang joker (terbuka) = sesi berakhir;
//    joker di tangan saat sesi berakhir = −500; tutup tangan dengan joker = +500
//  • Tutup tangan: kartu terakhir dibuang tertutup → sesi berakhir, +250
//  • Sesi juga berakhir saat dek habis
//  • Tersalip: skor positif yang tertinggal dari pemimpin → hangus ke 0
//  • Pemenang: pertama mencapai target skor (default 1000)
// ═══════════════════════════════════════════════════════════════════

export const SUITS = ["S", "H", "D", "C"] as const;
export type Suit = (typeof SUITS)[number];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
/** Kode kartu: "AS"=As♠ … "TD"=10♦ … "X1"/"X2" = joker */
export type CardCode = string;

/** Batas kursi permainan yang didukung oleh aturan, room, dan UI. */
export const MIN_ROOM_PLAYERS = 2;
export const MAX_ROOM_PLAYERS = 8;
export const CARDS_PER_PLAYER = 7;
export const DOUBLE_DECK_PLAYER_THRESHOLD = 4;
export const DOUBLE_DECK_CARD_COUNT = 104;

export const RANK_LABEL: Record<string, string> = {
  "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7",
  "8": "8", "9": "9", T: "10", J: "J", Q: "Q", K: "K", A: "A",
};

export const JOKERS: CardCode[] = ["X1", "X2"];
export const isJoker = (c: CardCode): boolean => c[0] === "X";
export const isRedCard = (c: CardCode): boolean => c[1] === "H" || c[1] === "D";

/** Nilai poin remi Indonesia: angka = 5, J/Q/K = 10, As = 15. Joker lepas = 50 (internal). */
export function cardPoints(c: CardCode): number {
  if (isJoker(c)) return 50;
  const r = c[0];
  if (r === "A") return 15;
  if (r === "J" || r === "Q" || r === "K") return 10;
  return 5;
}

export function fullDeck(): CardCode[] {
  const d: CardCode[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  d.push(...JOKERS);
  return d;
}

/**
 * Dua dek standar untuk meja lima hingga delapan pemain. Salinan kedua memakai suffix `~2`
 * sebagai identitas fisik kartu, tetapi seluruh aturan dan visual tetap
 * membaca dua karakter pertama (`AS`, `TD`, dan seterusnya).
 *
 * Joker sengaja tidak dimasukkan: jumlah kartu harus tepat 104 sesuai aturan
 * meja besar, bukan 108 kartu dari dua dek yang masing-masing berjoker.
 */
export function doubleDeck104(): CardCode[] {
  const standardDeck: CardCode[] = [];
  for (const s of SUITS) for (const r of RANKS) standardDeck.push(r + s);
  return [...standardDeck, ...standardDeck.map((card) => `${card}~2`)];
}

/** Pilih deck berdasarkan jumlah peserta sesi yang akan dimulai. */
export function deckForPlayerCount(playerCount: number): CardCode[] {
  return playerCount > DOUBLE_DECK_PLAYER_THRESHOLD ? doubleDeck104() : fullDeck();
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SEQ_ORDER: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };

export function sortHand(hand: CardCode[]): CardCode[] {
  const order = (c: CardCode) =>
    isJoker(c) ? 99 : SEQ_ORDER[c[0]] + SUIT_ORDER[c[1]] / 10;
  return [...hand].sort((a, b) => order(a) - order(b));
}

/** Poin MINUS kartu tangan: nilai kartu biasa; joker = 500. */
export function handPoints(hand: CardCode[]): number {
  return hand.reduce((s, c) => s + (isJoker(c) ? 500 : cardPoints(c)), 0);
}

export function cardLabel(c: CardCode): string {
  if (isJoker(c)) return "Joker";
  const r = RANK_LABEL[c[0]] ?? c[0];
  const s: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
  return `${r}${s[c[1]] ?? c[1]}`;
}

// ── Meld / kombinasi jadi ─────────────────────────────────────────
export interface Meld {
  id: string;
  ownerSeat: number;
  kind: "seri" | "set";
  cards: CardCode[];
  points: number;
}

const SEQ: string[] = [...RANKS]; // 2..A; As melingkar (sesudah A kembali ke 2)
const seqIdx = (r: string): number => SEQ.indexOf(r);

/**
 * Validasi kombinasi. `meldedBefore` = pemain sudah pernah buka.
 *  • seri: 3+ kartu sejenis berurutan (As melingkar), joker boleh menambal
 *  • set : 3–4 kartu berangka sama, jenis berbeda; joker boleh mengisi
 *  • tutupan PERTAMA: wajib seri murni (tanpa joker, bukan set)
 */
export function validateMeld(cards: CardCode[], meldedBefore = true): CardCode[] | null {
  if (cards.length < 3) return null;
  const jokers = cards.filter(isJoker);
  const nat = cards.filter((c) => !isJoker(c));
  if (nat.length === 0) return null;
  if (jokers.length > 0 && !meldedBefore) return null;

  // Seri
  if (nat.every((c) => c[1] === nat[0][1])) {
    const idxs = nat.map((c) => seqIdx(c[0]));
    if (new Set(idxs).size !== idxs.length) return null; // duplikat
    // window melingkar sepanjang persis cards.length yang memuat semua kartu natural
    for (let start = 0; start < 13; start++) {
      const win = new Set<number>();
      for (let k = 0; k < cards.length; k++) win.add((start + k) % 13);
      if (idxs.every((i) => win.has(i))) return cards;
    }
    return null;
  }

  // Set — tidak boleh sebagai tutupan pertama
  if (!meldedBefore) return null;
  if (nat.every((c) => c[0] === nat[0][0])) {
    const suits = new Set(nat.map((c) => c[1]));
    if (suits.size !== nat.length) return null;
    if (cards.length > 4) return null;
    return cards;
  }
  return null;
}

/** Nilai poin sebuah meld; joker dinilai sebagai kartu yang diwakilinya. */
export function meldPoints(meld: Meld): number {
  const nat = meld.cards.filter((c) => !isJoker(c));
  const nj = meld.cards.length - nat.length;
  const sum = nat.reduce((s, c) => s + cardPoints(c), 0);
  if (nj === 0) return sum;
  if (meld.kind === "set") {
    return sum + nj * cardPoints(nat[0] ?? "5S");
  }
  // seri: cari window yang memuat natural, joker mengisi posisi kosong
  const idxs = nat.map((c) => seqIdx(c[0]));
  for (let start = 0; start < 13; start++) {
    const win: number[] = [];
    for (let k = 0; k < meld.cards.length; k++) win.push((start + k) % 13);
    if (idxs.every((i) => win.includes(i))) {
      const empty = win.filter((i) => !idxs.includes(i));
      return sum + empty.reduce((s, i) => s + cardPoints(SEQ[i] + meld.cards.find((c) => !isJoker(c))![1]), 0);
    }
  }
  return sum + nj * cardPoints(nat[0] ?? "5S");
}

/** Semua kombinasi legal yang bisa dibuka dari tangan (untuk bot & hint UI). */
export function findMelds(hand: CardCode[], meldedBefore: boolean): CardCode[][] {
  const jokers = hand.filter(isJoker);
  const out: CardCode[][] = [];
  const seen = new Set<string>();
  const push = (m: CardCode[]) => {
    if (m.length < 3) return;
    if (!validateMeld(m, meldedBefore)) return;
    const key = [...m].sort().join(",");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };

  // Seri: untuk tiap jenis, coba semua window melingkar berisi ≥3 natural
  for (const s of SUITS) {
    const cardAt = new Map<number, CardCode>();
    for (const c of hand) {
      if (isJoker(c) || c[1] !== s) continue;
      cardAt.set(seqIdx(c[0]), c);
    }
    if (cardAt.size === 0) continue;
    for (let len = 3; len <= Math.min(13, cardAt.size + jokers.length); len++) {
      for (let start = 0; start < 13; start++) {
        const win: number[] = [];
        for (let k = 0; k < len; k++) win.push((start + k) % 13);
        const natIdx = win.filter((i) => cardAt.has(i));
        if (natIdx.length < 3) continue;
        // kedua ujung harus kartu natural (jangan boros joker di pinggir)
        if (!cardAt.has(win[0]) || !cardAt.has(win[win.length - 1])) continue;
        const gaps = len - natIdx.length;
        if (gaps === 0) push(natIdx.map((i) => cardAt.get(i)!));
        else if (meldedBefore && gaps <= jokers.length)
          push([...natIdx.map((i) => cardAt.get(i)!), ...jokers.slice(0, gaps)]);
      }
    }
  }

  // Set
  const byRank = new Map<string, CardCode[]>();
  for (const c of hand) {
    if (isJoker(c)) continue;
    const arr = byRank.get(c[0]) ?? [];
    arr.push(c);
    byRank.set(c[0], arr);
  }
  for (const cards of byRank.values()) {
    if (cards.length >= 3) push(cards);
    else if (meldedBefore && cards.length === 2 && jokers.length > 0)
      push([...cards, jokers[0]]);
  }

  // urut greedy: poin terbesar dulu; seimbang → yang tanpa joker didahulukan
  const pts = (m: CardCode[]) => m.reduce((s, c) => s + cardPoints(c), 0);
  const nj = (m: CardCode[]) => m.filter(isJoker).length;
  return out.sort((a, b) => pts(b) - pts(a) || nj(a) - nj(b) || b.length - a.length);
}

function removeCardsFromHand(
  hand: CardCode[],
  cards: CardCode[]
): CardCode[] | null {
  const remaining = [...hand];
  for (const card of cards) {
    const index = remaining.indexOf(card);
    if (index < 0) return null;
    remaining.splice(index, 1);
  }
  return remaining;
}

/**
 * Cari rangkaian meld legal untuk menuntaskan kewajiban ambil buangan.
 * Pencarian dibatasi oleh tangan maksimal 14 kartu (7 awal + 7 buangan), dan
 * setiap langkah selalu mengurangi minimal tiga kartu.
 */
export function planDiscardPickupMelds(
  hand: CardCode[],
  target: CardCode,
  hasMelded: boolean,
  openedCards = 0,
  targetMelded = false,
  requiredOpenedCards = 0
): CardCode[][] | null {
  const visited = new Set<string>();

  const search = (
    remaining: CardCode[],
    canUseJokersAndSets: boolean,
    opened: number,
    hasTarget: boolean
  ): CardCode[][] | null => {
    if (hasTarget && opened >= requiredOpenedCards) return [];

    const key = [
      canUseJokersAndSets ? "1" : "0",
      hasTarget ? "1" : "0",
      Math.min(opened, requiredOpenedCards),
      [...remaining].sort().join(","),
    ].join("|");
    if (visited.has(key)) return null;
    visited.add(key);

    const melds = findMelds(remaining, canUseJokersAndSets).sort(
      (left, right) =>
        Number(right.includes(target)) - Number(left.includes(target)) ||
        right.length - left.length
    );
    for (const meld of melds) {
      const next = removeCardsFromHand(remaining, meld);
      if (!next) continue;
      const rest = search(
        next,
        true,
        opened + meld.length,
        hasTarget || meld.includes(target)
      );
      if (rest) return [meld, ...rest];
    }
    return null;
  };

  return search(hand, hasMelded, openedCards, targetMelded);
}

// ── State ─────────────────────────────────────────────────────────
export interface PlayerState {
  seat: number;
  userId: number | null;
  name: string;
  avatar: string | null;
  isBot: boolean;
  /**
   * Kursi yang ditinggalkan pada private room tetap dipertahankan agar dapat
   * diisi pemain lain tanpa mengubah urutan meja yang sedang berjalan.
   */
  isVacant: boolean;
  /**
   * Pemain yang duduk saat sesi sedang berjalan baru menerima kartu dan masuk
   * rotasi giliran pada sesi berikutnya.
   */
  inRound: boolean;
  connected: boolean;
  hand: CardCode[];
  score: number;
  /** delta skor sesi terakhir */
  lastRoundPoints: number;
  /** sudah pernah buka (tutupan pertama seri murni) */
  hasMelded: boolean;
  joinedAt: number;
}

export type SessionReason = "tutup" | "tutupJoker" | "jokerDiscarded" | "deckOut";

export interface SessionDelta {
  seat: number;
  name: string;
  meldPlus: number;
  handMinus: number;
  bonus: number;
  delta: number;
  newScore: number;
  tersalip: boolean;
}

export interface RoundResult {
  session: number;
  reason: SessionReason;
  /** penutup (tutup tangan) bila ada */
  winnerSeat: number | null;
  deltas: SessionDelta[];
  targetReachedBy: number | null;
}

export interface RoundHistoryEntry {
  round: number;
  label: string;
  reason: SessionReason;
  /** penutup sesi (tutup tangan), bila ada */
  winnerSeat: number | null;
  deltas: { seat: number; delta: number }[];
}

/**
 * Kewajiban yang hanya berlaku pada giliran saat pemain mengambil tumpukan
 * buangan. Dengan tangan awal tujuh kartu dan satu kartu buangan penutup,
 * kedalaman `d` mensyaratkan sedikitnya `d` kartu dibuka.
 */
export interface DiscardPickupState {
  /** Kartu yang dipilih dari tumpukan (bukan kartu-kartu di atasnya). */
  target: CardCode;
  /** 0 = kartu paling atas, 6 = kartu ketujuh dari atas. */
  depth: number;
  /** Total kartu yang ikut diambil: depth + 1. */
  cardsTaken: number;
  /** Kartu yang sudah dipindahkan ke meld pada giliran ini. */
  openedCards: number;
  /** Target harus benar-benar termasuk salah satu meld giliran ini. */
  targetMelded: boolean;
}

export interface GameState {
  /** Asal meja menentukan aturan lobby dan privasi aksesnya. */
  matchType: "private" | "bot" | "stranger";
  status: "waiting" | "playing" | "roundEnd" | "finished";
  phase: "draw" | "play";
  round: number; // nomor sesi
  targetScore: number;
  maxPlayers: number;
  stock: CardCode[];
  discard: CardCode[];
  /** kartu tutup tangan (tertutup) */
  closedCard: CardCode | null;
  melds: Meld[];
  players: PlayerState[];
  turnSeat: number;
  turnStartedAt: number;
  hostSeat: number;
  winnerSeat: number | null;
  roundResult: RoundResult | null;
  roundHistory: RoundHistoryEntry[];
  log: { t: number; msg: string }[];
  statsRecorded: boolean;
  botActionAt: number;
  /** null kecuali pemain aktif mengambil kartu dari tumpukan buangan. */
  discardPickup: DiscardPickupState | null;
}

export function pushLog(state: GameState, msg: string) {
  state.log.push({ t: Date.now(), msg });
  if (state.log.length > 200) state.log = state.log.slice(-200);
}

export function makePlayer(p: {
  seat: number;
  userId: number | null;
  name: string;
  avatar: string | null;
  isBot: boolean;
}): PlayerState {
  return {
    seat: p.seat,
    userId: p.userId,
    name: p.name,
    avatar: p.avatar,
    isBot: p.isBot,
    isVacant: false,
    inRound: true,
    connected: true,
    hand: [],
    score: 0,
    lastRoundPoints: 0,
    hasMelded: false,
    joinedAt: Date.now(),
  };
}

export function createRoomState(opts: {
  hostUserId: number;
  hostName: string;
  hostAvatar: string | null;
  targetScore: number;
  maxPlayers: number;
  matchType?: GameState["matchType"];
}): GameState {
  if (
    !Number.isInteger(opts.maxPlayers) ||
    opts.maxPlayers < MIN_ROOM_PLAYERS ||
    opts.maxPlayers > MAX_ROOM_PLAYERS
  ) {
    throw new Error(`Room harus memiliki ${MIN_ROOM_PLAYERS}–${MAX_ROOM_PLAYERS} pemain`);
  }
  const state: GameState = {
    matchType: opts.matchType ?? "private",
    status: "waiting",
    phase: "draw",
    round: 0,
    targetScore: opts.targetScore,
    maxPlayers: opts.maxPlayers,
    stock: [],
    discard: [],
    closedCard: null,
    melds: [],
    players: [],
    turnSeat: 0,
    turnStartedAt: Date.now(),
    hostSeat: 0,
    winnerSeat: null,
    roundResult: null,
    roundHistory: [],
    log: [],
    statsRecorded: false,
    botActionAt: 0,
    discardPickup: null,
  };
  state.players.push(
    makePlayer({
      seat: 0,
      userId: opts.hostUserId,
      name: opts.hostName,
      avatar: opts.hostAvatar,
      isBot: false,
    }),
  );
  return state;
}

export function getPlayerByUser(state: GameState, userId: number): PlayerState | undefined {
  return state.players.find((p) => !isVacantSeat(p) && p.userId === userId);
}

/** State lama yang belum memiliki field baru dianggap sebagai kursi terisi. */
export function isVacantSeat(player: Pick<PlayerState, "isVacant">): boolean {
  return player.isVacant === true;
}

/** Peserta yang mendapat kartu dan boleh mengambil giliran pada sesi aktif. */
export function isRoundParticipant(
  player: Pick<PlayerState, "isVacant" | "inRound">,
): boolean {
  return !isVacantSeat(player) && player.inRound !== false;
}

export function occupiedPlayers(state: GameState): PlayerState[] {
  return state.players.filter((player) => !isVacantSeat(player));
}

function roundParticipants(state: GameState): PlayerState[] {
  return occupiedPlayers(state)
    .filter(isRoundParticipant)
    .sort((a, b) => a.seat - b.seat);
}

function playerAtSeat(state: GameState, seat: number): PlayerState | undefined {
  return state.players.find((player) => player.seat === seat);
}

function nextRoundParticipant(state: GameState, seat: number): PlayerState | undefined {
  const players = roundParticipants(state);
  if (players.length === 0) return undefined;
  return players.find((player) => player.seat > seat) ?? players[0];
}

/** Kursi pertama yang belum terisi, termasuk kursi yang belum pernah dibuat. */
export function firstOpenSeat(state: GameState): number | null {
  for (let seat = 0; seat < state.maxPlayers; seat++) {
    const player = playerAtSeat(state, seat);
    if (!player || isVacantSeat(player)) return seat;
  }
  return null;
}

/**
 * Menempatkan pemain/bot ke kursi kosong. Pada sesi aktif, pemain baru
 * menunggu sesi berikutnya agar tidak menerima kartu di tengah permainan.
 */
export function addPlayerToRoom(
  state: GameState,
  input: Omit<Parameters<typeof makePlayer>[0], "seat">,
): { player: PlayerState; joinsNextRound: boolean } {
  if (occupiedPlayers(state).length >= state.maxPlayers) {
    throw new Error("Room penuh");
  }
  const seat = firstOpenSeat(state);
  if (seat === null) throw new Error("Kursi room tidak tersedia");

  const joinsNextRound = state.status === "playing" || state.status === "roundEnd";
  const next = makePlayer({ ...input, seat });
  next.inRound = !joinsNextRound;

  const vacant = playerAtSeat(state, seat);
  if (vacant) Object.assign(vacant, next);
  else {
    state.players.push(next);
    state.players.sort((a, b) => a.seat - b.seat);
  }

  return { player: vacant ?? next, joinsNextRound };
}

function resetToWaiting(state: GameState) {
  state.status = "waiting";
  state.phase = "draw";
  state.stock = [];
  state.discard = [];
  state.closedCard = null;
  state.melds = [];
  state.roundResult = null;
  state.winnerSeat = null;
  state.botActionAt = 0;
  state.discardPickup = null;
  for (const player of occupiedPlayers(state)) {
    player.hand = [];
    player.hasMelded = false;
    player.lastRoundPoints = 0;
    player.inRound = true;
  }
}

/**
 * Keluarkan pemain manusia dari sebuah room.
 *
 * Lobby merapikan kursi yang tersisa. Saat permainan sudah dimulai, kursi
 * private dibiarkan kosong supaya dapat diisi pemain baru pada sesi berikutnya.
 * Match bot dan lawan online mempertahankan pengganti bot agar pertandingan
 * yang tidak menerima peserta baru tidak macet.
 * `shouldDestroy` bernilai true bila tidak ada manusia yang tersisa; pemanggil
 * harus menghapus room tersebut secara atomik dari penyimpanan.
 */
export function leavePlayerFromRoom(
  state: GameState,
  userId: number,
): { didLeave: boolean; shouldDestroy: boolean } {
  const me = getPlayerByUser(state, userId);
  if (!me) {
    return {
      didLeave: false,
      shouldDestroy: !occupiedPlayers(state).some(
        (player) => !player.isBot && player.userId !== null,
      ),
    };
  }

  if (state.status === "waiting") {
    state.players = state.players
      .filter((player) => player.seat !== me.seat && !isVacantSeat(player))
      .map((player, seat) => ({ ...player, seat }));
    if (state.hostSeat === me.seat) {
      const nextHuman = state.players.find(
        (player) => !player.isBot && player.userId !== null,
      );
      state.hostSeat = nextHuman ? nextHuman.seat : 0;
    }
    pushLog(state, `${me.name} keluar dari room`);
  } else if (state.matchType === "private") {
    const leftName = me.name;
    if (state.turnSeat === me.seat) state.discardPickup = null;
    // Kembalikan kartu yang belum selesai dimainkan ke stock dan singkirkan
    // meld pemilik kursi tersebut. Dengan begitu tidak ada kartu duplikat,
    // dan peserta tersisa dapat melanjutkan sesi tanpa "pemain hantu".
    if (state.status === "playing") {
      const returnedCards = [
        ...me.hand,
        ...state.melds
          .filter((meld) => meld.ownerSeat === me.seat)
          .flatMap((meld) => meld.cards),
      ];
      state.melds = state.melds.filter((meld) => meld.ownerSeat !== me.seat);
      if (returnedCards.length > 0) state.stock = shuffle([...state.stock, ...returnedCards]);
    }

    Object.assign(me, {
      userId: null,
      name: "Kursi kosong",
      avatar: null,
      isBot: false,
      isVacant: true,
      inRound: false,
      connected: false,
      hand: [],
      score: 0,
      lastRoundPoints: 0,
      hasMelded: false,
      joinedAt: Date.now(),
    });

    if (state.hostSeat === me.seat) {
      const nextHuman = occupiedPlayers(state).find(
        (player) => !player.isBot && player.userId !== null,
      );
      if (nextHuman) state.hostSeat = nextHuman.seat;
    }

    const participants = roundParticipants(state);
    if (state.status === "playing" && participants.length < MIN_ROOM_PLAYERS) {
      resetToWaiting(state);
      pushLog(state, `${leftName} keluar — sesi dibatalkan, menunggu pemain.`);
    } else if (state.status === "playing" && state.turnSeat === me.seat) {
      const next = nextRoundParticipant(state, me.seat);
      if (next) {
        state.turnSeat = next.seat;
        state.phase = "draw";
        state.turnStartedAt = Date.now();
        state.botActionAt = 0;
      }
      pushLog(state, `${leftName} keluar — kursinya kosong.`);
    } else {
      pushLog(state, `${leftName} keluar — kursinya kosong.`);
    }
  } else {
    // Permainan yang masih memiliki pemain manusia tetap berjalan dengan bot.
    me.isBot = true;
    me.userId = null;
    me.avatar = null;
    me.connected = false;
    me.name = me.name.startsWith("Bot") ? me.name : `${me.name} (Auto)`;
    const host = playerAtSeat(state, state.hostSeat);
    if (host?.isBot) {
      const nextHuman = state.players.find(
        (player) => !player.isBot && player.userId !== null,
      );
      if (nextHuman) state.hostSeat = nextHuman.seat;
    }
    pushLog(state, "Seorang pemain keluar — digantikan bot");
  }

  return {
    didLeave: true,
    shouldDestroy: !occupiedPlayers(state).some(
      (player) => !player.isBot && player.userId !== null,
    ),
  };
}

// ── Siklus sesi ───────────────────────────────────────────────────
export function startRound(state: GameState) {
  const participants = occupiedPlayers(state).sort((a, b) => a.seat - b.seat);
  const n = participants.length;
  if (n < MIN_ROOM_PLAYERS) throw new Error("Butuh minimal 2 pemain");
  if (n > state.maxPlayers || n > MAX_ROOM_PLAYERS)
    throw new Error(`Room hanya mendukung hingga ${MAX_ROOM_PLAYERS} pemain`);
  const deck = deckForPlayerCount(n);
  if (n * CARDS_PER_PLAYER + 1 > deck.length)
    throw new Error("Kartu tidak cukup untuk memulai permainan");
  state.round += 1;
  state.stock = shuffle(deck);
  state.discard = [];
  state.closedCard = null;
  state.melds = [];
  state.roundResult = null;
  state.discardPickup = null;
  for (const p of state.players) {
    p.hand = [];
    p.hasMelded = false;
    p.lastRoundPoints = 0;
    if (!isVacantSeat(p)) p.inRound = true;
  }
  for (let i = 0; i < CARDS_PER_PLAYER; i++)
    for (const p of participants) p.hand.push(state.stock.pop()!);
  state.discard.push(state.stock.pop()!);
  // sesi 1 mulai dari seat 0; sesi berikutnya dari pemegang skor tertinggi
  if (state.round === 1) state.turnSeat = participants[0].seat;
  else {
    let best = participants[0];
    for (const p of participants) if (p.score > best.score) best = p;
    state.turnSeat = best.seat;
  }
  state.phase = "draw";
  state.turnStartedAt = Date.now();
  state.botActionAt = 0;
  state.status = "playing";
  pushLog(state, `— Sesi ${state.round} dimulai · ${n} pemain × ${CARDS_PER_PLAYER} kartu —`);
}

function currentPlayer(state: GameState): PlayerState {
  const player = playerAtSeat(state, state.turnSeat);
  if (!player || !isRoundParticipant(player)) {
    throw new Error("Giliran pemain tidak valid");
  }
  return player;
}

function endSessionDeckOut(state: GameState) {
  pushLog(state, "Kartu deck habis! Sesi berakhir.");
  endSession(state, "deckOut", null);
}

// ── Aksi giliran ──────────────────────────────────────────────────
export function drawCard(
  state: GameState,
  userId: number,
  from: "stock" | "discard",
  depth = 0,
): CardCode[] {
  if (state.status !== "playing" || state.phase !== "draw")
    throw new Error("Bukan fase ambil kartu");
  const p = currentPlayer(state);
  if (p.userId !== userId) throw new Error("Bukan giliranmu");
  return drawCardInternal(state, from, depth);
}

export function meldCards(state: GameState, userId: number, cards: CardCode[]): Meld {
  if (state.status !== "playing" || state.phase !== "play")
    throw new Error("Bukan fase bermain");
  const p = currentPlayer(state);
  if (p.userId !== userId) throw new Error("Bukan giliranmu");
  if (!p.hasMelded && cards.some(isJoker))
    throw new Error("Tutupan pertama harus SERI (urutan satu jenis) tanpa joker");
  return meldCardsInternal(state, cards);
}

export function discardCard(
  state: GameState,
  userId: number,
  card: CardCode,
  faceDown = false,
) {
  if (state.status !== "playing" || state.phase !== "play")
    throw new Error("Bukan fase bermain");
  const p = currentPlayer(state);
  if (p.userId !== userId) throw new Error("Bukan giliranmu");
  if (!p.hand.includes(card)) throw new Error("Kartu tidak ada di tanganmu");
  discardCardInternal(state, card, faceDown);
}

function advanceTurn(state: GameState) {
  const next = nextRoundParticipant(state, state.turnSeat);
  if (!next) {
    resetToWaiting(state);
    return;
  }
  state.turnSeat = next.seat;
  state.phase = "draw";
  state.discardPickup = null;
  state.turnStartedAt = Date.now();
  if (state.stock.length === 0) endSessionDeckOut(state);
}

function endSession(state: GameState, reason: SessionReason, closerSeat: number | null) {
  const participants = roundParticipants(state);
  const prevScores = new Map(participants.map((player) => [player.seat, player.score]));
  const deltas: SessionDelta[] = participants.map((p) => {
    const meldPlus = state.melds
      .filter((m) => m.ownerSeat === p.seat)
      .reduce((s, m) => s + m.points, 0);
    const handMinus = handPoints(p.hand);
    const bonus =
      closerSeat === p.seat ? (reason === "tutupJoker" ? 500 : reason === "tutup" ? 250 : 0) : 0;
    const delta = meldPlus - handMinus + bonus;
    p.lastRoundPoints = delta;
    p.score += delta;
    return {
      seat: p.seat,
      name: p.name,
      meldPlus,
      handMinus,
      bonus,
      delta,
      newScore: p.score,
      tersalip: false,
    };
  });

  // aturan tersalip: jika pemain X yang tadinya di bawah/diimbangi Y kini melampaui Y,
  // maka skor Y hangus ke 0 — berlaku untuk skor positif maupun negatif
  for (const y of participants) {
    const prevY = prevScores.get(y.seat) ?? y.score;
    const salip = participants.some(
      (x) =>
        x.seat !== y.seat &&
        (prevScores.get(x.seat) ?? x.score) <= prevY &&
        x.score > y.score,
    );
    if (salip && y.score !== 0) {
      y.score = 0;
      const d = deltas.find((dd) => dd.seat === y.seat)!;
      d.tersalip = true;
      d.newScore = 0;
    }
  }
  if (deltas.some((d) => d.tersalip))
    pushLog(
      state,
      `Tersalip! Skor ${deltas.filter((d) => d.tersalip).map((d) => d.name).join(", ")} hangus ke 0.`,
    );

  // target tercapai?
  let targetReachedBy: number | null = null;
  let best = -Infinity;
  for (const p of participants) {
    if (p.score >= state.targetScore && p.score > best) {
      best = p.score;
      targetReachedBy = p.seat;
    }
  }

  state.roundResult = {
    session: state.round,
    reason,
    winnerSeat: closerSeat,
    deltas,
    targetReachedBy,
  };
  const reasonLabel =
    reason === "tutup"
      ? `${playerAtSeat(state, closerSeat!)?.name ?? "Pemain"} tutup tangan`
      : reason === "tutupJoker"
        ? `${playerAtSeat(state, closerSeat!)?.name ?? "Pemain"} tutup dengan joker`
        : reason === "jokerDiscarded"
          ? "Joker dibuang terbuka"
          : "Deck habis";
  state.roundHistory.push({
    round: state.round,
    label: reasonLabel,
    reason,
    winnerSeat: closerSeat,
    deltas: deltas.map((d) => ({ seat: d.seat, delta: d.delta })),
  });

  if (targetReachedBy !== null) {
    state.status = "finished";
    state.winnerSeat = targetReachedBy;
    pushLog(
      state,
      `${playerAtSeat(state, targetReachedBy)?.name ?? "Pemain"} mencapai ${
        playerAtSeat(state, targetReachedBy)?.score ?? 0
      } poin — MENANG!`,
    );
  } else {
    state.status = "roundEnd";
  }
  state.discardPickup = null;
}

// ── Sanitasi state untuk klien ────────────────────────────────────
export interface ClientPlayer {
  seat: number;
  userId: number | null;
  name: string;
  avatar: string | null;
  isBot: boolean;
  isVacant: boolean;
  inRound: boolean;
  isHost: boolean;
  handCount: number;
  hand?: CardCode[];
  score: number;
  lastRoundPoints: number;
  hasMelded: boolean;
  /** poin PLUS dari meld sendiri di sesi ini */
  meldPlus: number;
  /** poin MINUS kartu tangan (hanya untuk diri sendiri / saat reveal) */
  handMinus?: number;
}

export interface ClientState {
  matchType: GameState["matchType"];
  status: GameState["status"];
  phase: GameState["phase"];
  round: number;
  targetScore: number;
  maxPlayers: number;
  stockCount: number;
  discard: CardCode[];
  closedCard: CardCode | null;
  melds: Meld[];
  players: ClientPlayer[];
  turnSeat: number;
  turnStartedAt: number;
  hostSeat: number;
  winnerSeat: number | null;
  roundResult: RoundResult | null;
  roundHistory: RoundHistoryEntry[];
  log: { t: number; msg: string }[];
  /**
   * Hanya dikirim kepada pemain yang sedang mendapat giliran, agar kartu
   * target dan progres kewajiban ambil buangan tidak terekspos ke lawan.
   */
  discardPickup: DiscardPickupState | null;
  you: { seat: number } | null;
}

export function sanitizeState(state: GameState, userId: number | null): ClientState {
  const reveal = state.status === "roundEnd" || state.status === "finished";
  const me = userId != null ? getPlayerByUser(state, userId) : undefined;
  const discardPickup =
    me?.seat === state.turnSeat && state.discardPickup
      ? { ...state.discardPickup }
      : null;
  const players: ClientPlayer[] = state.players.map((p) => {
    const showHand = !isVacantSeat(p) && (reveal || p.seat === me?.seat);
    return {
      seat: p.seat,
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      isBot: p.isBot,
      isVacant: isVacantSeat(p),
      inRound: p.inRound !== false,
      isHost: p.seat === state.hostSeat,
      handCount: p.hand.length,
      hand: showHand ? [...p.hand] : undefined,
      score: p.score,
      lastRoundPoints: p.lastRoundPoints,
      hasMelded: p.hasMelded,
      meldPlus: state.melds
        .filter((m) => m.ownerSeat === p.seat)
        .reduce((s, m) => s + m.points, 0),
      handMinus: showHand ? handPoints(p.hand) : undefined,
    };
  });
  return {
    matchType: state.matchType ?? "private",
    status: state.status,
    phase: state.phase,
    round: state.round,
    targetScore: state.targetScore,
    maxPlayers: state.maxPlayers,
    stockCount: state.stock.length,
    discard: [...state.discard],
    closedCard: reveal ? state.closedCard : state.closedCard ? "BACK" : null,
    melds: state.melds.map((m) => ({ ...m })),
    players,
    turnSeat: state.turnSeat,
    turnStartedAt: state.turnStartedAt,
    hostSeat: state.hostSeat,
    winnerSeat: state.winnerSeat,
    roundResult: state.roundResult,
    roundHistory: state.roundHistory.slice(-30),
    log: state.log.slice(-60),
    discardPickup,
    you: me ? { seat: me.seat } : null,
  };
}

// ── Bot greedy (sesuai makalah) ───────────────────────────────────
export const BOT_DELAY_MS = 1100;
export const TURN_TIMEOUT_MS = 75_000;

/** Kegunaan kartu terhadap tangan: pasangan set / kedekatan seri (As melingkar).
 *  Sebelum buka, kedekatan seri lebih bernilai (tutupan pertama wajib seri). */
function cardUsefulness(card: CardCode, hand: CardCode[], opened: boolean): number {
  if (isJoker(card)) return 100;
  let u = 0;
  for (const o of hand) {
    if (o === card || isJoker(o)) continue;
    if (o[0] === card[0]) u += opened ? 3 : 1;
    else if (o[1] === card[1]) {
      const d = Math.abs(seqIdx(o[0]) - seqIdx(card[0]));
      const gap = Math.min(d, 13 - d);
      if (gap === 1) u += opened ? 3 : 4;
      else if (gap === 2) u += opened ? 1 : 2;
    }
  }
  return u;
}

/** Greedy: kartu buangan teratas dievaluasi satu per satu (maks 7). */
function bestDiscardTake(state: GameState, p: PlayerState): number {
  let bestDepth = -1;
  let bestProfit = 0;
  for (let depth = 0; depth < Math.min(7, state.discard.length); depth++) {
    const target = state.discard[state.discard.length - 1 - depth];
    const combos = findMelds([...p.hand, target], p.hasMelded).filter((m) =>
      m.includes(target),
    );
    if (combos.length === 0) continue;
    const taken = state.discard.slice(state.discard.length - 1 - depth);
    if (
      !planDiscardPickupMelds(
        [...p.hand, ...taken],
        target,
        p.hasMelded,
        0,
        false,
        depth
      )
    ) {
      continue;
    }
    // untung = poin kombinasi jadi − beban kartu acak yang ikut terambil
    const gain = combos[0].reduce((s, c) => s + cardPoints(c), 0);
    const extra = state.discard.slice(state.discard.length - depth);
    const burden = extra.reduce((s, c) => s + (isJoker(c) ? 0 : cardPoints(c)), 0) / 2;
    const profit = gain - burden - depth * 2;
    if (profit > bestProfit) {
      bestProfit = profit;
      bestDepth = depth;
    }
  }
  return bestDepth;
}

type BotAction =
  | { type: "drawStock" }
  | { type: "drawDiscard"; depth: number }
  | { type: "meld"; cards: CardCode[] }
  | { type: "discard"; card: CardCode; faceDown: boolean };

export function botNextAction(state: GameState): BotAction {
  const p = currentPlayer(state);

  if (state.phase === "draw") {
    const depth = bestDiscardTake(state, p);
    if (depth >= 0) return { type: "drawDiscard", depth };
    return { type: "drawStock" };
  }

  const pickup = state.discardPickup;
  if (
    pickup &&
    (!pickup.targetMelded || pickup.openedCards < pickup.depth)
  ) {
    const plan = planDiscardPickupMelds(
      p.hand,
      pickup.target,
      p.hasMelded,
      pickup.openedCards,
      pickup.targetMelded,
      pickup.depth
    );
    if (plan?.[0]) return { type: "meld", cards: plan[0] };
  }

  // fase play: buka kombinasi terbaik lebih dulu (greedy)
  const melds = findMelds(p.hand, p.hasMelded);
  if (melds.length > 0) return { type: "meld", cards: melds[0] };

  // tersisa satu kartu → tutup tangan
  if (p.hand.length === 1)
    return { type: "discard", card: p.hand[0], faceDown: true };

  // buang kartu paling tidak berguna & bernilai besar; jangan buang joker
  const candidates = p.hand.filter((c) => !isJoker(c));
  if (candidates.length === 0) {
    // hanya pegang joker → tutup dengan joker
    return { type: "discard", card: p.hand[0], faceDown: true };
  }
  let worst = candidates[0];
  let worstScore = Infinity;
  for (const c of candidates) {
    const s = cardUsefulness(c, p.hand, p.hasMelded) * 100 - cardPoints(c);
    if (s < worstScore) {
      worstScore = s;
      worst = c;
    }
  }
  return { type: "discard", card: worst, faceDown: false };
}

function botPlayStep(state: GameState): boolean {
  const p = currentPlayer(state);
  const before = JSON.stringify([state.turnSeat, state.phase, state.status, p.hand.length]);
  const action = botNextAction(state);
  try {
    switch (action.type) {
      case "drawStock":
        drawCardInternal(state, "stock", 0);
        break;
      case "drawDiscard":
        drawCardInternal(state, "discard", action.depth);
        break;
      case "meld":
        meldCardsInternal(state, action.cards);
        break;
      case "discard":
        discardCardInternal(state, action.card, action.faceDown);
        break;
    }
  } catch {
    // fallback paksa agar giliran tak pernah macet
    try {
      if (state.status === "playing" && state.phase === "draw") drawCardInternal(state, "stock", 0);
      if (state.status === "playing" && state.phase === "play") {
        const c = p.hand.filter((x) => !isJoker(x)).sort((a, b) => cardPoints(b) - cardPoints(a))[0] ?? p.hand[0];
        discardCardInternal(state, c, p.hand.length === 1);
      }
    } catch {
      /* sesi sudah berakhir */
    }
  }
  const after = JSON.stringify([state.turnSeat, state.phase, state.status, p.hand.length]);
  return before !== after;
}

// varian internal tanpa cek userId (dipakai bot / timeout otomatis / fungsi publik)
function drawCardInternal(
  state: GameState,
  from: "stock" | "discard",
  depth: number,
): CardCode[] {
  const p = currentPlayer(state);
  if (state.status !== "playing" || state.phase !== "draw")
    throw new Error("Bukan fase ambil kartu");
  if (from === "stock") {
    if (state.stock.length === 0) {
      endSessionDeckOut(state);
      return [];
    }
    const card = state.stock.pop()!;
    p.hand.push(card);
    state.discardPickup = null;
    state.phase = "play";
    return [card];
  }
  // dari tumpukan buangan: depth 0..6 (7 kartu teratas)
  if (depth < 0 || depth > 6) throw new Error("Hanya boleh mengambil 7 kartu teratas");
  if (depth >= state.discard.length)
    throw new Error("Tumpukan buangan tidak sedalam itu");
  const target = state.discard[state.discard.length - 1 - depth];
  const combos = findMelds([...p.hand, target], p.hasMelded).filter((m) =>
    m.includes(target),
  );
  if (combos.length === 0)
    throw new Error("Kartu itu belum menjadi kombinasi jadi dengan kartumu");

  const taken = state.discard.slice(state.discard.length - 1 - depth);
  const plan = planDiscardPickupMelds(
    [...p.hand, ...taken],
    target,
    p.hasMelded,
    0,
    false,
    depth
  );
  if (!plan) {
    throw new Error(
      `Ambilan ini tidak bisa diselesaikan: buka kartu target dan minimal ${depth} kartu sebelum membuang.`
    );
  }

  state.discard.splice(state.discard.length - 1 - depth);
  p.hand.push(...taken);
  state.discardPickup = {
    target,
    depth,
    cardsTaken: taken.length,
    openedCards: 0,
    targetMelded: false,
  };
  state.phase = "play";
  pushLog(
    state,
    `${p.name} mengambil ${taken.length > 1 ? `${taken.length} kartu` : cardLabel(target)} dari buangan`,
  );
  return taken;
}

function meldCardsInternal(state: GameState, cards: CardCode[]): Meld {
  const p = currentPlayer(state);
  for (const c of cards) if (!p.hand.includes(c)) throw new Error("kartu tak ada");
  const resolved = validateMeld(cards, p.hasMelded);
  if (!resolved) throw new Error("kombinasi tidak valid");
  const nats = cards.filter((c) => !isJoker(c));
  const kind: "seri" | "set" = nats.every((c) => c[0] === nats[0][0]) ? "set" : "seri";
  for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
  const meld: Meld = {
    id: `m${state.round}-${p.seat}-${state.melds.length}`,
    ownerSeat: p.seat,
    kind,
    cards,
    points: 0,
  };
  meld.points = meldPoints(meld);
  state.melds.push(meld);
  p.hasMelded = true;
  if (state.discardPickup) {
    state.discardPickup.openedCards += cards.length;
    if (cards.includes(state.discardPickup.target)) {
      state.discardPickup.targetMelded = true;
    }
  }
  pushLog(state, `${p.name} buka ${kind}: ${cards.map(cardLabel).join(" ")} (+${meld.points})`);
  if (p.hand.length === 0) endSession(state, "tutup", p.seat);
  return meld;
}

function discardCardInternal(state: GameState, card: CardCode, faceDown: boolean) {
  const p = currentPlayer(state);
  const i = p.hand.indexOf(card);
  if (i < 0) throw new Error("kartu tak ada");
  const pickup = state.discardPickup;
  if (pickup) {
    if (!pickup.targetMelded) {
      throw new Error(
        `Kartu target ${cardLabel(pickup.target)} dari buangan wajib dibuka terlebih dahulu.`
      );
    }
    if (pickup.openedCards < pickup.depth) {
      throw new Error(
        `Ambil ${pickup.cardsTaken} kartu dari buangan: buka minimal ${pickup.depth} kartu sebelum membuang.`
      );
    }
    if (p.hand.length - 1 > CARDS_PER_PLAYER) {
      throw new Error(
        `Sisa kartu setelah membuang harus maksimal ${CARDS_PER_PLAYER}.`
      );
    }
  }
  if (faceDown) {
    if (p.hand.length !== 1) throw new Error("bukan kartu terakhir");
    p.hand.splice(i, 1);
    state.closedCard = card;
    const withJoker = isJoker(card);
    pushLog(state, `${p.name} TUTUP TANGAN${withJoker ? " dengan JOKER" : ""}!`);
    endSession(state, withJoker ? "tutupJoker" : "tutup", p.seat);
    return;
  }
  if (isJoker(card)) {
    p.hand.splice(i, 1);
    state.discard.push(card);
    pushLog(state, `${p.name} membuang JOKER — sesi berakhir!`);
    endSession(state, "jokerDiscarded", null);
    return;
  }
  if (p.hand.length === 1) {
    // kartu terakhir tak boleh dibuang terbuka → tutup saja
    discardCardInternal(state, card, true);
    return;
  }
  p.hand.splice(i, 1);
  state.discard.push(card);
  advanceTurn(state);
}

/** Memajukan bot / auto-play pemain yang timeout. Dipanggil lazy saat ada request. */
export function tickGame(state: GameState): boolean {
  if (state.status !== "playing") return false;
  const now = Date.now();
  let acted = false;
  let guard = 0;
  while (state.status === "playing" && guard++ < 50) {
    const p = playerAtSeat(state, state.turnSeat);
    // Kursi yang sengaja dikosongkan dan pemain yang baru duduk tidak pernah
    // menjadi lawan bot/timeout. Lewati defensif bila snapshot lama masih
    // menunjuk ke kursi tersebut.
    if (!p || !isRoundParticipant(p)) {
      const next = nextRoundParticipant(state, state.turnSeat);
      if (!next || next.seat === state.turnSeat) {
        resetToWaiting(state);
        return true;
      }
      state.turnSeat = next.seat;
      state.phase = "draw";
      state.turnStartedAt = Date.now();
      state.botActionAt = 0;
      acted = true;
      continue;
    }
    if (p.isBot || !p.connected) {
      if (now < state.botActionAt) break;
      const moved = botPlayStep(state);
      state.botActionAt = Date.now() + BOT_DELAY_MS;
      // `botActionAt` juga bagian state terpersisten. Bahkan bila fallback bot
      // tidak dapat mengubah kartu karena state rusak/akhir sesi, simpan delay
      // agar scheduler event-driven tidak berputar segera tanpa henti.
      acted = true;
      if (!moved) break;
    } else {
      if (now - state.turnStartedAt >= TURN_TIMEOUT_MS) {
        pushLog(state, `${p.name} kehabisan waktu — giliran dimainkan otomatis.`);
        botPlayStep(state);
        state.turnStartedAt = Date.now();
        acted = true;
      }
      break;
    }
  }
  return acted;
}

export const BOT_NAMES = [
  "Bot Kartini", "Bot Gajah", "Bot Kakek", "Bot Nyi Roro", "Bot Paijo", "Bot Slamet",
  "Bot Srikandi",
];
export const TARGET_SCORES = [250, 500, 1000];

export function generateRoomCode(): string {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += abc[Math.floor(Math.random() * abc.length)];
  return code;
}
