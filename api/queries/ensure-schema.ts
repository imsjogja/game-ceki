import mysql from "mysql2/promise";
import { env } from "../lib/env";

/**
 * Bootstrap skema idempoten saat server produksi start.
 * CREATE TABLE IF NOT EXISTS — aman dijalankan berulang,
 * tidak mengubah data yang sudah ada.
 */
export async function ensureSchema() {
  const conn = await mysql.createConnection(env.databaseUrl);
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        unionId varchar(255) NOT NULL,
        name varchar(255),
        email varchar(320),
        avatar text,
        role enum('user','admin') NOT NULL DEFAULT 'user',
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        lastSignInAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY users_unionId_unique (unionId)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code varchar(8) NOT NULL,
        name varchar(64) NOT NULL,
        status enum('waiting','playing','roundEnd','finished') NOT NULL DEFAULT 'waiting',
        targetScore int NOT NULL DEFAULT 250,
        hostUserId bigint unsigned,
        state json NOT NULL,
        version int NOT NULL DEFAULT 1,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY rooms_code_unique (code),
        KEY rooms_code_idx (code)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS player_stats (
        userId bigint unsigned NOT NULL PRIMARY KEY,
        gamesPlayed int NOT NULL DEFAULT 0,
        gamesWon int NOT NULL DEFAULT 0,
        roundsWon int NOT NULL DEFAULT 0,
        rummyCount int NOT NULL DEFAULT 0,
        totalPoints int NOT NULL DEFAULT 0,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT player_stats_user_fk FOREIGN KEY (userId) REFERENCES users (id)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
        roomCode varchar(8) NOT NULL,
        winnerName varchar(255) NOT NULL,
        winnerUserId bigint unsigned,
        targetScore int NOT NULL,
        rounds int NOT NULL,
        players json NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY matches_winner_idx (winnerUserId)
      )
    `);
    console.log("[db] Skema dipastikan tersedia");
  } finally {
    await conn.end();
  }
}
