import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  json,
  int,
  bigint,
  index,
} from "drizzle-orm/mysql-core";
import type { GameState } from "../contracts/rummy";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================================
// RemiKu tables
// ============================================================

export const rooms = mysqlTable(
  "rooms",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 8 }).notNull().unique(),
    name: varchar("name", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["waiting", "playing", "roundEnd", "finished"])
      .default("waiting")
      .notNull(),
    targetScore: int("targetScore").default(250).notNull(),
    hostUserId: bigint("hostUserId", { mode: "number", unsigned: true }),
    state: json("state").$type<GameState>().notNull(),
    version: int("version").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    codeIdx: index("rooms_code_idx").on(table.code),
  }),
);

export const playerStats = mysqlTable("player_stats", {
  userId: bigint("userId", { mode: "number", unsigned: true })
    .primaryKey()
    .references(() => users.id),
  gamesPlayed: int("gamesPlayed").default(0).notNull(),
  gamesWon: int("gamesWon").default(0).notNull(),
  roundsWon: int("roundsWon").default(0).notNull(),
  rummyCount: int("rummyCount").default(0).notNull(),
  totalPoints: int("totalPoints").default(0).notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const matches = mysqlTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    roomCode: varchar("roomCode", { length: 8 }).notNull(),
    winnerName: varchar("winnerName", { length: 255 }).notNull(),
    winnerUserId: bigint("winnerUserId", { mode: "number", unsigned: true }),
    targetScore: int("targetScore").notNull(),
    rounds: int("rounds").notNull(),
    players: json("players")
      .$type<
        {
          name: string;
          userId: number | null;
          isBot: boolean;
          score: number;
        }[]
      >()
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    winnerIdx: index("matches_winner_idx").on(table.winnerUserId),
  }),
);

export type Room = typeof rooms.$inferSelect;
export type PlayerStat = typeof playerStats.$inferSelect;
export type Match = typeof matches.$inferSelect;
