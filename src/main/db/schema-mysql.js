const { mysqlTable, int, text, varchar, index } = require('drizzle-orm/mysql-core');

const profiles = mysqlTable('profiles', {
    id: varchar('id', { length: 64 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    proxyStr: text('proxy_str').default(''),
    tags: text('tags').default('[]'),
    notes: text('notes').default(''),
    preProxyOverride: varchar('pre_proxy_override', { length: 32 }).default('default'),
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
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    proxy_str TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    pre_proxy_override VARCHAR(32) DEFAULT 'default',
    debug_port INT,
    custom_args TEXT DEFAULT '',
    ignore_cert_errors INT DEFAULT 0,
    is_setup INT DEFAULT 0,
    created_at INT NOT NULL,
    fingerprint TEXT NOT NULL,
    INDEX idx_profiles_name (name),
    INDEX idx_profiles_created (created_at)
);
`;

module.exports = { profiles, CREATE_TABLE_SQL };
