// ═══════════════════════════════════════════════════════════════════
// REMI INDONESIA (CEKI) — mesin permainan bersama server & klien.
// Merujuk makalah "Strategi Greedy pada Permainan Kartu Remi"
// (IF2211 Strategi Algoritma, ITB, 2020/2021):
//  • 2–4 pemain, masing-masing 7 kartu, dek 52 + 2 joker
//  • Nilai: 2–10 = 5 poin, J/Q/K = 10, As = 15, Joker = nilai kartu yang diwakili
//  • Kartu jadi (di meja) = poin PLUS; sisa kartu tangan = poin MINUS
//  • Tutupan (kombinasi) pertama tiap pemain WAJIB seri (urutan sejenis) & tanpa joker
//  • As melingkar: K-A-2 dan A-2-3 sama-sama sah
//  • Tidak ada layoff — kartu tidak bisa ditempel ke kombinasi yang sudah di meja
//  • Ambil buangan: hanya 7 kartu teratas; kartu target + minimal 2 kartu tangan
//    harus menjadi kombinasi jadi; semua kartu di atasnya ikut terambil
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
  let sum = nat.reduce((s, c) => s + cardPoints(c), 0);
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

// ── State ─────────────────────────────────────────────────────────
export interface PlayerState {
  seat: number;
  userId: number | null;
  name: string;
  avatar: string | null;
  isBot: boolean;
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
  return state.players.find((p) => p.userId === userId);
}

/**
 * Keluarkan pemain manusia dari sebuah room.
 *
 * Lobby merapikan kursi yang tersisa. Saat permainan sudah dimulai, kursi
 * pemain diambil alih bot supaya pemain lain tetap dapat menyelesaikan sesi.
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
      shouldDestroy: !state.players.some((player) => !player.isBot),
    };
  }

  if (state.status === "waiting") {
    state.players = state.players
      .filter((player) => player.seat !== me.seat)
      .map((player, seat) => ({ ...player, seat }));
    if (state.hostSeat === me.seat) {
      const nextHuman = state.players.find((player) => !player.isBot);
      state.hostSeat = nextHuman ? nextHuman.seat : 0;
    }
    pushLog(state, `${me.name} keluar dari room`);
  } else {
    // Permainan yang masih memiliki pemain manusia tetap berjalan dengan bot.
    me.isBot = true;
    me.userId = null;
    me.avatar = null;
    me.connected = false;
    me.name = me.name.startsWith("Bot") ? me.name : `${me.name} (Auto)`;
    const host = state.players.find((player) => player.seat === state.hostSeat);
    if (host?.isBot) {
      const nextHuman = state.players.find((player) => !player.isBot);
      if (nextHuman) state.hostSeat = nextHuman.seat;
    }
    pushLog(state, "Seorang pemain keluar — digantikan bot");
  }

  return {
    didLeave: true,
    shouldDestroy: !state.players.some((player) => !player.isBot),
  };
}

// ── Siklus sesi ───────────────────────────────────────────────────
export function startRound(state: GameState) {
  const n = state.players.length;
  if (n < 2) throw new Error("Butuh minimal 2 pemain");
  state.round += 1;
  state.stock = shuffle(fullDeck());
  state.discard = [];
  state.closedCard = null;
  state.melds = [];
  state.roundResult = null;
  for (const p of state.players) {
    p.hand = [];
    p.hasMelded = false;
    p.lastRoundPoints = 0;
  }
  for (let i = 0; i < 7; i++)
    for (const p of state.players) p.hand.push(state.stock.pop()!);
  state.discard.push(state.stock.pop()!);
  // sesi 1 mulai dari seat 0; sesi berikutnya dari pemegang skor tertinggi
  if (state.round === 1) state.turnSeat = 0;
  else {
    let best = 0;
    for (const p of state.players) if (p.score > state.players[best].score) best = p.seat;
    state.turnSeat = best;
  }
  state.phase = "draw";
  state.turnStartedAt = Date.now();
  state.botActionAt = 0;
  state.status = "playing";
  pushLog(state, `— Sesi ${state.round} dimulai · ${n} pemain × 7 kartu —`);
}

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.turnSeat];
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
  state.turnSeat = (state.turnSeat + 1) % state.players.length;
  state.phase = "draw";
  state.turnStartedAt = Date.now();
  if (state.stock.length === 0) endSessionDeckOut(state);
}

function endSession(state: GameState, reason: SessionReason, closerSeat: number | null) {
  const prevScores = state.players.map((p) => p.score);
  const deltas: SessionDelta[] = state.players.map((p) => {
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
  for (const y of state.players) {
    const prevY = prevScores[y.seat];
    const salip = state.players.some(
      (x) =>
        x.seat !== y.seat &&
        prevScores[x.seat] <= prevY &&
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
  for (const p of state.players) {
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
      ? `${state.players[closerSeat!].name} tutup tangan`
      : reason === "tutupJoker"
        ? `${state.players[closerSeat!].name} tutup dengan joker`
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
      `${state.players[targetReachedBy].name} mencapai ${state.players[targetReachedBy].score} poin — MENANG!`,
    );
  } else {
    state.status = "roundEnd";
  }
}

// ── Sanitasi state untuk klien ────────────────────────────────────
export interface ClientPlayer {
  seat: number;
  userId: number | null;
  name: string;
  avatar: string | null;
  isBot: boolean;
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
  you: { seat: number } | null;
}

export function sanitizeState(state: GameState, userId: number | null): ClientState {
  const reveal = state.status === "roundEnd" || state.status === "finished";
  const me = userId != null ? getPlayerByUser(state, userId) : undefined;
  const players: ClientPlayer[] = state.players.map((p) => {
    const showHand = reveal || p.seat === me?.seat;
    return {
      seat: p.seat,
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      isBot: p.isBot,
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
  const taken = state.discard.splice(state.discard.length - 1 - depth);
  p.hand.push(...taken);
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
  pushLog(state, `${p.name} buka ${kind}: ${cards.map(cardLabel).join(" ")} (+${meld.points})`);
  if (p.hand.length === 0) endSession(state, "tutup", p.seat);
  return meld;
}

function discardCardInternal(state: GameState, card: CardCode, faceDown: boolean) {
  const p = currentPlayer(state);
  const i = p.hand.indexOf(card);
  if (i < 0) throw new Error("kartu tak ada");
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
    const p = state.players[state.turnSeat];
    if (p.isBot || !p.connected) {
      if (now < state.botActionAt) break;
      const moved = botPlayStep(state);
      acted = acted || moved;
      state.botActionAt = Date.now() + BOT_DELAY_MS;
      if (!moved) break;
    } else {
      if (now - state.turnStartedAt > TURN_TIMEOUT_MS) {
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
];
export const TARGET_SCORES = [250, 500, 1000];

export function generateRoomCode(): string {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += abc[Math.floor(Math.random() * abc.length)];
  return code;
}
