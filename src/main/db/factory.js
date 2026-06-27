const path = require('path');

/**
 * 根据配置创建 Drizzle ORM 实例
 * @param {{ type: string, url?: string, path?: string }} dbConfig
 * @param {string} dataPath - 默认数据目录
 * @returns {{ db: object, profiles: object, type: string, close: () => void }}
 */
async function createDatabase(dbConfig, dataPath) {
    switch (dbConfig.type) {
        case 'sqlite': {
            const Database = require('better-sqlite3');
            const { drizzle } = require('drizzle-orm/better-sqlite3');
            const { profiles, CREATE_TABLE_SQL } = require('./schema-sqlite');

            const dbPath = dbConfig.path || path.join(dataPath, 'profiles.db');
            const sqlite = new Database(dbPath);
            sqlite.pragma('journal_mode = WAL');
            sqlite.pragma('foreign_keys = ON');

            // 自动建表
            sqlite.exec(CREATE_TABLE_SQL);

            const db = drizzle({ client: sqlite });

            return {
                db,
                profiles,
                type: 'sqlite',
                close: () => sqlite.close(),
            };
        }

        case 'postgres': {
            const { drizzle } = require('drizzle-orm/node-postgres');
            const { Pool } = require('pg');
            const { profiles, CREATE_TABLE_SQL } = require('./schema-pg');

            const pool = new Pool({ connectionString: dbConfig.url });
            const db = drizzle({ client: pool });

            // 自动建表
            await pool.query(CREATE_TABLE_SQL);

            return {
                db,
                profiles,
                type: 'postgres',
                close: () => pool.end(),
            };
        }

        case 'mysql': {
            const { drizzle } = require('drizzle-orm/mysql2');
            const mysql = require('mysql2/promise');
            const { profiles, CREATE_TABLE_SQL } = require('./schema-mysql');

            const pool = mysql.createPool(dbConfig.url);
            const db = drizzle({ client: pool });

            // 自动建表
            await pool.query(CREATE_TABLE_SQL);

            return {
                db,
                profiles,
                type: 'mysql',
                close: () => pool.end(),
            };
        }

        default:
            throw new Error(`Unsupported database type: ${dbConfig.type}`);
    }
}

module.exports = { createDatabase };
