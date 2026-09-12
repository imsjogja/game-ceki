import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  clearPlayerRoomPresence,
  clearRoomPresence,
  getLiveRoomPresence,
  touchRoomPresence,
} from "./presence";
import {
  destroyGameRoom,
  disconnectGameUser,
  publishGameRoom,
  scheduleGameRoom,
} from "./game-router";
import { destroyVoiceRoom, disconnectVoiceUser } from "./voice-router";
import { rooms } from "@db/schema";
import {
  getRoomByCode,
  getRoomsByCodes,
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
  const host = state.players.find(p => p.seat === state.hostSeat);
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
  roomDestroyed: boolean
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

/**
 * State room berubah lewat tRPC; kabarkan snapshot ke semua subscriber lalu
 * jadwalkan bot/timeout berikutnya tanpa menunggu browser mem-poll.
 *
 * Kegagalan socket/scheduler tidak boleh membatalkan mutasi DB yang sudah
 * otoritatif. Reconnect client dan rehydrate scheduler akan memulihkan state.
 */
async function synchronizeRealtimeRoom(roomCode: string) {
  const results = await Promise.allSettled([
    publishGameRoom(roomCode),
    scheduleGameRoom(roomCode),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        `[game] sinkronisasi realtime room ${roomCode} gagal:`,
        result.reason
      );
    }
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
            .refine(n =>
              (ONLINE_OPPONENT_COUNTS as readonly number[]).includes(n)
            ),
          targetScore: z
            .number()
            .refine(n => (TARGET_SCORES as readonly number[]).includes(n)),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await enqueueMatchmaking(
            ctx.user,
            input.opponents as OnlineOpponentCount,
            input.targetScore
          );
          if (result.status === "matched") {
            await synchronizeRealtimeRoom(result.roomCode);
          }
          return result;
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
          .refine(n => (TARGET_SCORES as readonly number[]).includes(n))
          .default(500),
        maxPlayers: z.number().min(2).max(4).default(4),
        name: z.string().trim().max(48).optional(),
      })
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
      await getDb()
        .insert(rooms)
        .values({
          code,
          name: input.name || `Meja ${ctx.user.name ?? "Pemain"}`,
          status: "waiting",
          targetScore: input.targetScore,
          hostUserId: ctx.user.id,
          state,
        });
      await synchronizeRealtimeRoom(code);
      return { code };
    }),

  // Main vs Bot: buat room, isi bot, langsung mulai
  quickPlay: authedQuery
    .input(
      z.object({
        bots: z.number().int().min(1).max(3).default(1),
        targetScore: z
          .number()
          .refine(n => (TARGET_SCORES as readonly number[]).includes(n))
          .default(250),
      })
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
          })
        );
      }
      startRound(state);
      pushLog(state, `Duel vs ${input.bots} bot dimulai`);
      await getDb()
        .insert(rooms)
        .values({
          code,
          name: `${ctx.user.name ?? "Pemain"} vs Bot`,
          status: "playing",
          targetScore: input.targetScore,
          hostUserId: ctx.user.id,
          state,
        });
      await synchronizeRealtimeRoom(code);
      return { code };
    }),

  join: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, state => {
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
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  leave: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const outcome = await withRoomAndDestroyIf(
          input.code,
          state => leavePlayerFromRoom(state, ctx.user.id),
          (_state, _room, result) => result.shouldDestroy
        );

        if (outcome.result.didLeave) {
          clearPlayerRoomPresence(String(ctx.user.id), input.code);
          disconnectVoiceUser(input.code, ctx.user.id);
          disconnectGameUser(input.code, ctx.user.id);
        }
        if (outcome.destroyed) {
          clearRoomPresence(input.code);
          destroyVoiceRoom(input.code);
          destroyGameRoom(input.code);
        } else if (outcome.result.didLeave) {
          await synchronizeRealtimeRoom(input.code);
        }
        await cleanMatchmakingAfterLeave(
          ctx.user.id,
          input.code,
          outcome.destroyed
        );

        return { ok: true };
      } catch (error) {
        if (!(error instanceof TRPCError)) {
          throw error;
        }
        if (error.code === "NOT_FOUND") {
          // Idempoten: room mungkin sudah dihapus oleh manusia terakhir lain
          // yang keluar pada saat hampir bersamaan. Pemain ini tetap boleh
          // kembali ke beranda dan langsung mencari match baru.
          clearPlayerRoomPresence(String(ctx.user.id), input.code);
          disconnectVoiceUser(input.code, ctx.user.id);
          disconnectGameUser(input.code, ctx.user.id);
          await cleanMatchmakingAfterLeave(ctx.user.id, input.code, false);
          return { ok: true };
        }
        if (error.code === "CONFLICT") {
          // Bila retry optimistic lock kalah dari request lain, cek sekali
          // lagi. Jika request itu ternyata sudah mengeluarkan pemain ini atau
          // menghancurkan room, perlakukan leave sebagai sukses agar UI tidak
          // tertahan pada URL room yang sudah mati.
          const currentRoom = await getRoomByCode(input.code);
          if (
            !currentRoom ||
            !getPlayerByUser(currentRoom.state, ctx.user.id)
          ) {
            clearPlayerRoomPresence(String(ctx.user.id), input.code);
            disconnectVoiceUser(input.code, ctx.user.id);
            disconnectGameUser(input.code, ctx.user.id);
            await cleanMatchmakingAfterLeave(
              ctx.user.id,
              input.code,
              !currentRoom
            );
            return { ok: true };
          }
        }
        throw error;
      }
    }),

  addBot: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, state => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Permainan sudah dimulai",
          });
        if (state.players.length >= state.maxPlayers)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Kursi penuh" });
        const used = new Set(state.players.map(p => p.name));
        const name =
          BOT_NAMES.find(n => !used.has(n)) ??
          `Bot ${state.players.length + 1}`;
        state.players.push(
          makePlayer({
            seat: state.players.length,
            userId: null,
            name,
            avatar: null,
            isBot: true,
          })
        );
        pushLog(state, `${name} bergabung`);
        return { ok: true };
      });
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  removePlayer: authedQuery
    .input(z.object({ code: codeSchema, seat: z.number().int().min(0).max(3) }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, state => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Permainan sudah dimulai",
          });
        if (input.seat === state.hostSeat)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Host tidak bisa dikeluarkan",
          });
        const target = state.players.find(p => p.seat === input.seat);
        if (!target) return { removedUserId: null };
        state.players = state.players
          .filter(p => p.seat !== input.seat)
          .map((p, i) => ({ ...p, seat: i }));
        state.hostSeat = 0;
        pushLog(state, `${target.name} dikeluarkan dari room`);
        return { removedUserId: target.isBot ? null : target.userId };
      });
      if (result.removedUserId !== null) {
        clearPlayerRoomPresence(String(result.removedUserId), input.code);
        disconnectVoiceUser(input.code, result.removedUserId);
        disconnectGameUser(input.code, result.removedUserId);
      }
      await synchronizeRealtimeRoom(input.code);
      return { ok: true };
    }),

  setOptions: authedQuery
    .input(
      z.object({
        code: codeSchema,
        targetScore: z
          .number()
          .refine(n => (TARGET_SCORES as readonly number[]).includes(n)),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, state => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Permainan sudah dimulai",
          });
        state.targetScore = input.targetScore;
        return { ok: true };
      });
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  start: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, async (state, room) => {
        assertHost(state, ctx.user.id);
        if (state.status !== "waiting")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Permainan sudah berjalan",
          });
        startRound(state);
        await maybeRecordMatch(room, state);
        return { ok: true };
      });
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  nextRound: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, async (state, room) => {
        const me = getPlayerByUser(state, ctx.user.id);
        if (!me)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Kamu bukan pemain room ini",
          });
        if (state.status !== "roundEnd")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Sesi belum selesai",
          });
        startRound(state);
        await maybeRecordMatch(room, state);
        return { ok: true };
      });
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  rematch: authedQuery
    .input(z.object({ code: codeSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, state => {
        const me = getPlayerByUser(state, ctx.user.id);
        if (!me)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Kamu bukan pemain room ini",
          });
        if (state.status !== "finished")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Permainan belum selesai",
          });
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
        const human = state.players.filter(p => !p.isBot);
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
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  // ---------- Snapshot awal / fallback reconnect ----------
  get: publicQuery
    .input(z.object({ code: codeSchema }))
    .query(async ({ ctx, input }) => {
      const room = await getRoomByCode(input.code);
      if (!room) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Room tidak ditemukan",
        });
      }
      const player = ctx.user
        ? getPlayerByUser(room.state, ctx.user.id)
        : undefined;
      touchRoomPresence(
        player && !player.isBot ? String(ctx.user!.id) : null,
        room.code
      );
      // Fallback aman bila server baru aktif sebelum rehydrate scheduler selesai.
      void scheduleGameRoom(room.code);
      return {
        code: room.code,
        version: room.version,
        name: room.name,
        state: sanitizeState(room.state, ctx.user?.id ?? null),
      };
    }),

  // ---------- Aksi permainan ----------
  draw: authedQuery
    .input(
      z.object({
        code: codeSchema,
        from: z.enum(["stock", "discard"]),
        depth: z.number().int().min(0).max(6).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, async (state, room) => {
        const cards = drawCard(state, ctx.user.id, input.from, input.depth);
        await maybeRecordMatch(room, state);
        return { cards };
      });
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  meld: authedQuery
    .input(
      z.object({ code: codeSchema, cards: z.array(cardSchema).min(3).max(13) })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, async (state, room) => {
        const meld = meldCards(state, ctx.user.id, input.cards as never);
        await maybeRecordMatch(room, state);
        return { meldId: meld.id };
      });
      await synchronizeRealtimeRoom(input.code);
      return result;
    }),

  discard: authedQuery
    .input(
      z.object({
        code: codeSchema,
        card: cardSchema,
        faceDown: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await withRoom(input.code, async (state, room) => {
        discardCard(state, ctx.user.id, input.card as never, input.faceDown);
        await maybeRecordMatch(room, state);
        return { ok: true };
      });
      await synchronizeRealtimeRoom(input.code);
      return result;
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

  /**
   * Statistik dan direktori meja sedang berjalan.
   *
   * Room buatan teman (`private`) tidak masuk daftar agar tetap hanya dapat
   * ditemukan melalui kode/link undangan. Meja bot dan lawan online aman untuk
   * ditonton: snapshot publik selalu menyembunyikan kartu tangan pemain.
   */
  liveStats: publicQuery.query(async () => {
    const presence = getLiveRoomPresence();
    const roomsInDatabase = await getRoomsByCodes(
      presence.map(room => room.code),
    );
    const roomByCode = new Map(roomsInDatabase.map(room => [room.code, room]));
    const rooms = presence.flatMap(presenceRoom => {
      const room = roomByCode.get(presenceRoom.code);
      if (
        !room ||
        room.state.matchType === "private" ||
        (room.status !== "playing" && room.status !== "roundEnd")
      ) {
        return [];
      }
      return [
        {
          code: room.code,
          name: room.name,
          status: room.status,
          targetScore: room.targetScore,
          maxPlayers: room.state.maxPlayers,
          matchType: room.state.matchType,
          playersOnline: presenceRoom.playersOnline,
        },
      ];
    });
    return {
      playersOnline: presence.reduce(
        (total, room) => total + room.playersOnline,
        0,
      ),
      activeRooms: presence.length,
      rooms,
    };
  }),
});
