import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  clearPlayerRoomPresence,
  clearRoomPresence,
  getLiveStats,
  touchRoomPresence,
} from "./presence";
import { destroyVoiceRoom } from "./voice-router";
import { rooms } from "@db/schema";
import {
  getRoomByCode,
  withRoom,
  withRoomAndDestroyIf,
  maybeRecordMatch,
  getLeaderboard,
  getUserStats,
  getUserMatches,
} from "./queries/rooms";
import {
  createRoomState,
  generateRoomCode,
  getPlayerByUser,
  leavePlayerFromRoom,
  makePlayer,
  startRound,
  drawCard,
  meldCards,
  discardCard,
  tickGame,
  sanitizeState,
  pushLog,
  BOT_NAMES,
  TARGET_SCORES,
  type GameState,
} from "@contracts/rummy";
import {
  ONLINE_OPPONENT_COUNTS,
  type OnlineOpponentCount,
} from "@contracts/matchmaking";
import {
  cancelMatchmaking,
  clearMatchmakingForRoom,
  clearMatchmakingForUserInRoom,
  enqueueMatchmaking,
  getMatchmakingStatus,
} from "./queries/matchmaking";

const cardSchema = z
  .string()
  .regex(/^([A2-9TJQK][SHDC]|X[12])$/, "Kartu tidak valid");
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{6}$/, "Kode room harus 6 karakter");

function assertHost(state: GameState, userId: number) {
  const host = state.players.find((p) => p.seat === state.hostSeat);
  if (!host || host.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Hanya host yang bisa melakukan ini",
    });
  }
}

function matchmakingError(error: unknown): never {
  if (error instanceof Error && error.message) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Pencarian lawan sedang bermasalah. Coba lagi.",
  });
}

async function cleanMatchmakingAfterLeave(
  userId: number,
  roomCode: string,
  roomDestroyed: boolean,
) {
  try {
    if (roomDestroyed) {
      await clearMatchmakingForRoom(roomCode);
    } else {
      await clearMatchmakingForUserInRoom(userId, roomCode);
    }
  } catch {
    // Room sudah berhasil dimutasi. Jangan menahan navigasi pemain hanya
    // karena cleanup sekunder gagal; enqueue juga memvalidasi keanggotaan room
    // sebelum memakai kembali tiket matched yang tersisa.
    console.error(`Matchmaking cleanup gagal untuk room ${roomCode}.`);
  }
}

export const rummyRouter = createRouter({
  matchmaking: createRouter({
    enqueue: authedQuery
      .input(
        z.object({
          opponents: z
            .number()
            .int()
            .refine((n) =>
              (ONLINE_OPPONENT_COUNTS as readonly number[]).includes(n),
            ),
          targetScore: z
            .number()
            .refine((n) => (TARGET_SCORES as readonly number[]).includes(n)),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await enqueueMatchmaking(
            ctx.user,
            input.opponents as OnlineOpponentCount,
            input.targetScore,
          );
        } catch (error) {
          return matchmakingError(error);
        }
      }),

    status: authedQuery.query(async ({ ctx }) => {
      try {
        return await getMatchmakingStatus(ctx.user.id);
      } catch (error) {
        return matchmakingError(error);
      }
    }),

    cancel: authedQuery.mutation(async ({ ctx }) => {
      try {
        return await cancelMatchmaking(ctx.user.id);
      } catch (error) {
        return matchmakingError(error);
      }
    }),
  }),

  // ---------- Room ----------
  create: authedQuery
    .input(
      z.object({
        targetScore: z
          .number()
          .refine((n) => (TARGET_SCORES as readonly number[]).includes(n))
          .default(500),
        maxPlayers: z.number().min(2).max(4).default(4),
        name: z.string().trim().max(48).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let code = generateRoomCode();
      for (let i = 0; i < 5; i++) {
        if (!(await getRoomByCode(code))) break;
        code = generateRoomCode();
      }
      const state = createRoomState({
        hostUserId: ctx.user.id,
        hostName: ctx.user.name ?? "Pemain",
        hostAvatar: ctx.user.avatar ?? null,
        targetScore: input.targetScore,
        maxPlayers: input.maxPlayers,
        matchType: "private",
      });
      pushLog(state, `${ctx.user.name ?? "Pemain"} membuat room`);
      await getDb().insert(rooms).values({
        code,
        name: input.name || `Meja ${ctx.user.name ?? "Pemain"}`,
        status: "waiting",
        targetScore: input.targetScore,
        hostUserId: ctx.user.id,
        state,
      });
      return { code };
    }),

  // Main vs Bot: buat room, isi bot, langsung mulai
  quickPlay: authedQuery
    .input(
      z.object({
        bots: z.number().int().min(1).max(3).default(1),
        targetScore: z
          .number()
          .refine((n) => (TARGET_SCORES as readonly number[]).includes(n))
          .default(250),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let code = generateRoomCode();
      for (let i = 0; i < 5; i++) {
        if (!(await getRoomByCode(code))) break;
        code = generateRoomCode();
      }
      const state = createRoomState({
        hostUserId: ctx.user.id,
        hostName: ctx.user.name ?? "Pemain",
        hostAvatar: ctx.user.avatar ?? null,
        targetScore: input.targetScore,
        maxPlayers: input.bots + 1,
        matchType: "bot",
      });
      for (let i = 0; i < input.bots; i++) {
        state.players.push(
          makePlayer({
            seat: state.players.length,
            userId: null,
            name: BOT_NAMES[i % BOT_NAMES.length],
            avatar: null,
            isBot: true,
          }),
        );
      }
      startRound(state);
      pushLog(state, `Duel vs ${input.bots} bot dimulai`);
      await getDb().insert(rooms).values({
        code,
        name: `${ctx.user.name ?? "Pemain"} vs Bot`,
        status: "playing",
        targetScore: input.targetScore,
        hostUserId: ctx.user.id,
        state,
      });
      return { code };
    }),

  join: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, (state) => {
        const existing = getPlayerByUser(state, ctx.user.id);
        if (existing) return { seat: existing.seat, already: true };
        if (state.status !== "waiting")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Permainan sudah dimulai di room ini",
          });
        if (state.players.length >= state.maxPlayers)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Room penuh" });
        const player = makePlayer({
          seat: state.players.length,
          userId: ctx.user.id,
          name: ctx.user.name ?? "Pemain",
          avatar: ctx.user.avatar ?? null,
          isBot: false,
        });
        state.players.push(player);
        pushLog(state, `${ctx.user.name ?? "Pemain"} bergabung`);
        return { seat: player.seat, already: false };
      });
    }),

  leave: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const outcome = await withRoomAndDestroyIf(
          input.code,
          (state) => leavePlayerFromRoom(state, ctx.user.id),
          (_state, _room, result) => result.shouldDestroy,
        );

        if (outcome.result.didLeave) {
          clearPlayerRoomPresence(String(ctx.user.id), input.code);
        }
        if (outcome.destroyed) {
          clearRoomPresence(input.code);
          destroyVoiceRoom(input.code);
        }
        await cleanMatchmakingAfterLeave(
          ctx.user.id,
          input.code,
          outcome.destroyed,
        );

        return { ok: true };
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") {
          throw error;
        }
        // Idempoten: room mungkin sudah dihapus oleh manusia terakhir lain
        // yang keluar pada saat hampir bersamaan. Pemain ini tetap boleh
        // kembali ke beranda dan langsung mencari match baru.
        clearPlayerRoomPresence(String(ctx.user.id), input.code);
        await cleanMatchmakingAfterLeave(ctx.user.id, input.code, false);
        return { ok: true };
      }
    }),

  addBot: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, (state) => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permainan sudah dimulai" });
        if (state.players.length >= state.maxPlayers)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Kursi penuh" });
        const used = new Set(state.players.map((p) => p.name));
        const name =
          BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${state.players.length + 1}`;
        state.players.push(
          makePlayer({
            seat: state.players.length,
            userId: null,
            name,
            avatar: null,
            isBot: true,
          }),
        );
        pushLog(state, `${name} bergabung`);
        return { ok: true };
      });
    }),

  removePlayer: authedQuery
    .input(z.object({ code: codeSchema, seat: z.number().int().min(0).max(3) }))
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, (state) => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permainan sudah dimulai" });
        if (input.seat === state.hostSeat)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Host tidak bisa dikeluarkan" });
        const target = state.players.find((p) => p.seat === input.seat);
        if (!target) return { ok: true };
        state.players = state.players
          .filter((p) => p.seat !== input.seat)
          .map((p, i) => ({ ...p, seat: i }));
        state.hostSeat = 0;
        pushLog(state, `${target.name} dikeluarkan dari room`);
        return { ok: true };
      });
    }),

  setOptions: authedQuery
    .input(
      z.object({
        code: codeSchema,
        targetScore: z
          .number()
          .refine((n) => (TARGET_SCORES as readonly number[]).includes(n)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, (state) => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permainan sudah dimulai" });
        state.targetScore = input.targetScore;
        return { ok: true };
      });
    }),

  start: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, async (state, room) => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permainan sudah berjalan" });
        startRound(state);
        await maybeRecordMatch(room, state);
        return { ok: true };
      });
    }),

  nextRound: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, async (state, room) => {
        const me = getPlayerByUser(state, ctx.user.id);
        if (!me) throw new TRPCError({ code: "FORBIDDEN", message: "Kamu bukan pemain room ini" });
        if (state.status !== "roundEnd")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Sesi belum selesai" });
        startRound(state);
        await maybeRecordMatch(room, state);
        return { ok: true };
      });
    }),

  rematch: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, (state) => {
        const me = getPlayerByUser(state, ctx.user.id);
        if (!me) throw new TRPCError({ code: "FORBIDDEN", message: "Kamu bukan pemain room ini" });
        if (state.status !== "finished")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Permainan belum selesai" });
        // reset ke lobby dengan pemain yang sama
        state.status = "waiting";
        state.matchType = "private";
        state.round = 0;
        state.roundHistory = [];
        state.melds = [];
        state.discard = [];
        state.stock = [];
        state.closedCard = null;
        state.roundResult = null;
        state.winnerSeat = null;
        state.statsRecorded = false;
        state.botActionAt = 0;
        const human = state.players.filter((p) => !p.isBot);
        state.hostSeat = human.length > 0 ? human[0].seat : 0;
        for (const p of state.players) {
          p.hand = [];
          p.score = 0;
          p.lastRoundPoints = 0;
          p.hasMelded = false;
        }
        pushLog(state, "Rematch — kembali ke lobby");
        return { ok: true };
      });
    }),

  // ---------- State (polling) ----------
  get: publicQuery
    .input(z.object({ code: codeSchema }))
    .query(async ({ ctx, input }) => {
      return withRoom(input.code, async (state, room) => {
        if (
          state.matchType === "stranger" &&
          !getPlayerByUser(state, ctx.user?.id ?? -1)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Room lawan online hanya dapat diakses oleh pesertanya.",
          });
        }
        // Lazy tick: gerakkan bot / timeout pemain
        tickGame(state);
        // sinyal kehadiran untuk statistik live di landing
        touchRoomPresence(ctx.user ? String(ctx.user.id) : null, room.code);
        await maybeRecordMatch(room, state);
        return {
          code: room.code,
          name: room.name,
          state: sanitizeState(state, ctx.user?.id ?? null),
        };
      });
    }),

  // ---------- Aksi permainan ----------
  draw: authedQuery
    .input(
      z.object({
        code: codeSchema,
        from: z.enum(["stock", "discard"]),
        depth: z.number().int().min(0).max(6).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, async (state, room) => {
        const cards = drawCard(state, ctx.user.id, input.from, input.depth);
        await maybeRecordMatch(room, state);
        return { cards };
      });
    }),

  meld: authedQuery
    .input(z.object({ code: codeSchema, cards: z.array(cardSchema).min(3).max(13) }))
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, async (state, room) => {
        const meld = meldCards(state, ctx.user.id, input.cards as never);
        await maybeRecordMatch(room, state);
        return { meldId: meld.id };
      });
    }),

  discard: authedQuery
    .input(
      z.object({
        code: codeSchema,
        card: cardSchema,
        faceDown: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withRoom(input.code, async (state, room) => {
        discardCard(state, ctx.user.id, input.card as never, input.faceDown);
        await maybeRecordMatch(room, state);
        return { ok: true };
      });
    }),

  // ---------- Statistik ----------
  myStats: authedQuery.query(async ({ ctx }) => {
    const [stats, history] = await Promise.all([
      getUserStats(ctx.user.id),
      getUserMatches(ctx.user.id),
    ]);
    return { stats, history };
  }),

  leaderboard: publicQuery.query(async () => {
    return getLeaderboard();
  }),

  /** Statistik live: berapa pemain online & room aktif saat ini (in-memory). */
  liveStats: publicQuery.query(() => {
    return getLiveStats();
  }),
});
