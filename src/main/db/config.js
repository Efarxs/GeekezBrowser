/**
 * 读取数据库配置
 *
 * settings.json 中的 database 字段：
 * { "database": { "type": "sqlite" } }                           → 默认，本地
 * { "database": { "type": "sqlite", "path": "/custom/path.db" } } → 自定义路径
 * { "database": { "type": "postgres", "url": "postgres://..." } }
 * { "database": { "type": "mysql", "url": "mysql://..." } }
 *
 * 不配置 database 字段时默认 sqlite
 */

function getDbConfig(settings) {
    const db = (settings && settings.database) || {};
    const type = db.type || 'sqlite';

    if (type === 'sqlite') {
        return { type: 'sqlite', path: db.path || null };
    }
    if (type === 'postgres') {
        if (!db.url) throw new Error('PostgreSQL requires database.url in settings.json');
        return { type: 'postgres', url: db.url };
    }
    if (type === 'mysql') {
        if (!db.url) throw new Error('MySQL requires database.url in settings.json');
        return { type: 'mysql', url: db.url };
    }

    return { type: 'sqlite', path: null };
}

module.exports = { getDbConfig };
