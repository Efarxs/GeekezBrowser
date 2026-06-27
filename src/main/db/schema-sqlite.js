const { sqliteTable, text, int, index } = require('drizzle-orm/sqlite-core');

const profiles = sqliteTable('profiles', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    proxyStr: text('proxy_str').default(''),
    tags: text('tags').default('[]'),
    notes: text('notes').default(''),
    preProxyOverride: text('pre_proxy_override').default('default'),
    debugPort: int('debug_port'),
    customArgs: text('custom_args').default(''),
    ignoreCertErrors: int('ignore_cert_errors').default(0),
    isSetup: int('is_setup').default(0),
    createdAt: int('created_at').notNull(),
    fingerprint: text('fingerprint').notNull(),
}, (table) => [
    index('idx_profiles_name').on(table.name),
    index('idx_profiles_created').on(table.createdAt),
]);

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    proxy_str TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    pre_proxy_override TEXT DEFAULT 'default',
    debug_port INTEGER,
    custom_args TEXT DEFAULT '',
    ignore_cert_errors INTEGER DEFAULT 0,
    is_setup INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
CREATE INDEX IF NOT EXISTS idx_profiles_created ON profiles(created_at);
`;

module.exports = { profiles, CREATE_TABLE_SQL };
