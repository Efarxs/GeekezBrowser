const initSqlJs = require('sql.js');
const fs = require('fs-extra');
const path = require('path');

const DB_FILE_NAME = 'profiles.db';
const JSON_FILE_NAME = 'profiles.json';
const JSON_BACKUP_NAME = 'profiles.json.bak';

class ProfileDB {
    constructor(dataPath) {
        this.dataPath = dataPath;
        this.dbPath = path.join(dataPath, DB_FILE_NAME);
        this.jsonPath = path.join(dataPath, JSON_FILE_NAME);
        this.db = null;
        this.SQL = null;
    }

    async init() {
        this.SQL = await initSqlJs();

        if (fs.existsSync(this.dbPath)) {
            const buffer = fs.readFileSync(this.dbPath);
            this.db = new this.SQL.Database(buffer);
        } else {
            this.db = new this.SQL.Database();
            this._createSchema();
            await this._migrateFromJson();
        }
    }

    _createSchema() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                proxy_str TEXT DEFAULT '',
                tags TEXT DEFAULT '[]',
                notes TEXT DEFAULT '',
                pre_proxy_override TEXT DEFAULT 'default',
                debug_port INTEGER,
                custom_args TEXT DEFAULT '',
                is_setup INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                fingerprint TEXT NOT NULL
            );
        `);
        this.db.run('CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_profiles_created ON profiles(created_at);');
        this._persist();
    }

    _persist() {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
    }

    async _migrateFromJson() {
        if (!fs.existsSync(this.jsonPath)) return;
        try {
            const stat = fs.statSync(this.jsonPath);
            if (!stat || stat.size === 0) return;

            const profiles = await fs.readJson(this.jsonPath);
            if (!Array.isArray(profiles) || profiles.length === 0) return;

            this.db.run('BEGIN TRANSACTION');
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO profiles
                (id, name, proxy_str, tags, notes, pre_proxy_override, debug_port, custom_args, is_setup, created_at, fingerprint)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const p of profiles) {
                stmt.run([
                    p.id,
                    p.name || '',
                    p.proxyStr || '',
                    JSON.stringify(p.tags || []),
                    p.notes || '',
                    p.preProxyOverride || 'default',
                    p.debugPort || null,
                    p.customArgs || '',
                    p.isSetup ? 1 : 0,
                    p.createdAt || Date.now(),
                    JSON.stringify(p.fingerprint || {})
                ]);
            }
            stmt.free();
            this.db.run('COMMIT');
            this._persist();

            fs.renameSync(this.jsonPath, path.join(this.dataPath, JSON_BACKUP_NAME));
            console.log(`Migrated ${profiles.length} profiles from JSON to SQLite`);
        } catch (e) {
            console.error('Migration from profiles.json failed:', e.message);
        }
    }

    _rowToProfile(row) {
        return {
            id: row.id,
            name: row.name,
            proxyStr: row.proxy_str,
            tags: JSON.parse(row.tags || '[]'),
            notes: row.notes,
            preProxyOverride: row.pre_proxy_override,
            debugPort: row.debug_port,
            customArgs: row.custom_args,
            isSetup: !!row.is_setup,
            createdAt: row.created_at,
            fingerprint: JSON.parse(row.fingerprint || '{}')
        };
    }

    getAll() {
        const stmt = this.db.prepare('SELECT * FROM profiles ORDER BY created_at ASC');
        const results = [];
        while (stmt.step()) {
            results.push(this._rowToProfile(stmt.getAsObject()));
        }
        stmt.free();
        return results;
    }

    getById(id) {
        const stmt = this.db.prepare('SELECT * FROM profiles WHERE id = ?');
        stmt.bind([id]);
        let profile = null;
        if (stmt.step()) {
            profile = this._rowToProfile(stmt.getAsObject());
        }
        stmt.free();
        return profile;
    }

    getByName(name) {
        const stmt = this.db.prepare('SELECT * FROM profiles WHERE name = ?');
        stmt.bind([name]);
        let profile = null;
        if (stmt.step()) {
            profile = this._rowToProfile(stmt.getAsObject());
        }
        stmt.free();
        return profile;
    }

    nameExists(name, excludeId = null) {
        if (excludeId) {
            const stmt = this.db.prepare('SELECT COUNT(*) as cnt FROM profiles WHERE name = ? AND id != ?');
            stmt.bind([name, excludeId]);
            stmt.step();
            const cnt = stmt.getAsObject().cnt;
            stmt.free();
            return cnt > 0;
        }
        const stmt = this.db.prepare('SELECT COUNT(*) as cnt FROM profiles WHERE name = ?');
        stmt.bind([name]);
        stmt.step();
        const cnt = stmt.getAsObject().cnt;
        stmt.free();
        return cnt > 0;
    }

    getPaged(page = 1, pageSize = 20, search = '', tag = '') {
        const whereClauses = [];
        const params = [];

        if (search) {
            whereClauses.push('(name LIKE ? OR proxy_str LIKE ? OR tags LIKE ?)');
            const sp = `%${search}%`;
            params.push(sp, sp, sp);
        }
        if (tag) {
            whereClauses.push('tags LIKE ?');
            params.push(`%"${tag}"%`);
        }

        const where = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        const countStmt = this.db.prepare(`SELECT COUNT(*) as cnt FROM profiles ${where}`);
        countStmt.bind(params);
        countStmt.step();
        const totalCount = countStmt.getAsObject().cnt;
        countStmt.free();

        const offset = (page - 1) * pageSize;
        const dataStmt = this.db.prepare(`SELECT * FROM profiles ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`);
        dataStmt.bind([...params, pageSize, offset]);
        const items = [];
        while (dataStmt.step()) {
            items.push(this._rowToProfile(dataStmt.getAsObject()));
        }
        dataStmt.free();

        return { items, totalCount, page, pageSize, totalPages: Math.ceil(totalCount / pageSize) };
    }

    insert(profile) {
        this.db.run(`
            INSERT INTO profiles (id, name, proxy_str, tags, notes, pre_proxy_override, debug_port, custom_args, is_setup, created_at, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            profile.id,
            profile.name || '',
            profile.proxyStr || '',
            JSON.stringify(profile.tags || []),
            profile.notes || '',
            profile.preProxyOverride || 'default',
            profile.debugPort || null,
            profile.customArgs || '',
            profile.isSetup ? 1 : 0,
            profile.createdAt || Date.now(),
            JSON.stringify(profile.fingerprint || {})
        ]);
        this._persist();
    }

    update(id, profile) {
        this.db.run(`
            UPDATE profiles SET
                name = ?, proxy_str = ?, tags = ?, notes = ?, pre_proxy_override = ?,
                debug_port = ?, custom_args = ?, is_setup = ?, fingerprint = ?
            WHERE id = ?
        `, [
            profile.name || '',
            profile.proxyStr || '',
            JSON.stringify(profile.tags || []),
            profile.notes || '',
            profile.preProxyOverride || 'default',
            profile.debugPort || null,
            profile.customArgs || '',
            profile.isSetup ? 1 : 0,
            JSON.stringify(profile.fingerprint || {}),
            id
        ]);
        this._persist();
    }

    delete(id) {
        this.db.run('DELETE FROM profiles WHERE id = ?', [id]);
        this._persist();
    }

    upsert(profile) {
        const existing = this.getById(profile.id);
        if (existing) {
            this.update(profile.id, profile);
        } else {
            this.insert(profile);
        }
    }

    importBatch(profiles) {
        this.db.run('BEGIN TRANSACTION');
        for (const p of profiles) {
            const existing = this.getById(p.id);
            if (existing) {
                this.update(p.id, p);
            } else {
                this.db.run(`
                    INSERT INTO profiles (id, name, proxy_str, tags, notes, pre_proxy_override, debug_port, custom_args, is_setup, created_at, fingerprint)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    p.id,
                    p.name || '',
                    p.proxyStr || '',
                    JSON.stringify(p.tags || []),
                    p.notes || '',
                    p.preProxyOverride || 'default',
                    p.debugPort || null,
                    p.customArgs || '',
                    p.isSetup ? 1 : 0,
                    p.createdAt || Date.now(),
                    JSON.stringify(p.fingerprint || {})
                ]);
            }
        }
        this.db.run('COMMIT');
        this._persist();
    }

    getAllTags() {
        const stmt = this.db.prepare('SELECT tags FROM profiles');
        const tagSet = new Set();
        while (stmt.step()) {
            const row = stmt.getAsObject();
            try {
                const tags = JSON.parse(row.tags || '[]');
                tags.forEach(t => { if (t) tagSet.add(t); });
            } catch { /* ignore */ }
        }
        stmt.free();
        return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
    }

    exportAll() {
        return this.getAll();
    }

    close() {
        if (this.db) {
            this._persist();
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = { ProfileDB };
