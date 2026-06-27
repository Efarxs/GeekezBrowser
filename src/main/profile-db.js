const fs = require('fs-extra');
const path = require('path');
const { eq, like, or, asc, desc, sql } = require('drizzle-orm');

const JSON_FILE_NAME = 'profiles.json';
const JSON_BACKUP_NAME = 'profiles.json.bak';

class ProfileDB {
    /**
     * @param {{ db: object, profiles: object, type: string, close: () => void }} conn
     * @param {string} dataPath - 数据目录（用于 JSON 迁移）
     */
    constructor(conn, dataPath) {
        this.db = conn.db;
        this.table = conn.profiles;
        this.type = conn.type;
        this._close = conn.close;
        this.dataPath = dataPath;
    }

    async init() {
        await this._migrateFromJson();
    }

    async _migrateFromJson() {
        const jsonPath = path.join(this.dataPath, JSON_FILE_NAME);
        const jsonBakPath = path.join(this.dataPath, JSON_BACKUP_NAME);
        if (!fs.existsSync(jsonPath)) return;

        try {
            const stat = fs.statSync(jsonPath);
            if (!stat || stat.size === 0) return;

            const profiles = await fs.readJson(jsonPath);
            if (!Array.isArray(profiles) || profiles.length === 0) return;

            // 检查是否已有数据，避免重复迁移
            const existing = await this.getAll();
            if (existing.length > 0) {
                // 已有数据，直接备份 JSON
                fs.renameSync(jsonPath, jsonBakPath);
                return;
            }

            await this.importBatch(profiles.map(p => ({
                id: p.id,
                name: p.name || '',
                proxyStr: p.proxyStr || '',
                tags: p.tags || [],
                notes: p.notes || '',
                preProxyOverride: p.preProxyOverride || 'default',
                debugPort: p.debugPort || null,
                customArgs: p.customArgs || '',
                isSetup: p.isSetup || false,
                createdAt: p.createdAt || Date.now(),
                fingerprint: p.fingerprint || {},
            })));

            fs.renameSync(jsonPath, jsonBakPath);
            console.log(`Migrated ${profiles.length} profiles from JSON to database`);
        } catch (e) {
            console.error('Migration from profiles.json failed:', e.message);
        }
    }

    _rowToProfile(row) {
        return {
            id: row.id,
            name: row.name,
            proxyStr: row.proxyStr || '',
            tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []),
            notes: row.notes || '',
            preProxyOverride: row.preProxyOverride || 'default',
            debugPort: row.debugPort || null,
            customArgs: row.customArgs || '',
            ignoreCertErrors: !!row.ignoreCertErrors,
            isSetup: !!row.isSetup,
            createdAt: row.createdAt,
            fingerprint: typeof row.fingerprint === 'string' ? JSON.parse(row.fingerprint || '{}') : (row.fingerprint || {}),
        };
    }

    _toDbValues(profile) {
        return {
            id: profile.id,
            name: profile.name || '',
            proxyStr: profile.proxyStr || '',
            tags: typeof profile.tags === 'string' ? profile.tags : JSON.stringify(profile.tags || []),
            notes: profile.notes || '',
            preProxyOverride: profile.preProxyOverride || 'default',
            debugPort: profile.debugPort || null,
            customArgs: profile.customArgs || '',
            ignoreCertErrors: profile.ignoreCertErrors ? 1 : 0,
            isSetup: profile.isSetup ? 1 : 0,
            createdAt: profile.createdAt || Date.now(),
            fingerprint: typeof profile.fingerprint === 'string' ? profile.fingerprint : JSON.stringify(profile.fingerprint || {}),
        };
    }

    async getAll() {
        const rows = await this.db.select().from(this.table).orderBy(asc(this.table.createdAt));
        return rows.map(r => this._rowToProfile(r));
    }

    async getById(id) {
        const rows = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
        return rows[0] ? this._rowToProfile(rows[0]) : null;
    }

    async getByName(name) {
        const rows = await this.db.select().from(this.table).where(eq(this.table.name, name)).limit(1);
        return rows[0] ? this._rowToProfile(rows[0]) : null;
    }

    async nameExists(name, excludeId = null) {
        if (excludeId) {
            const rows = await this.db.select({ cnt: sql`count(*)`.mapWith(Number) })
                .from(this.table)
                .where(sql`${this.table.name} = ${name} AND ${this.table.id} != ${excludeId}`);
            return (rows[0]?.cnt || 0) > 0;
        }
        const rows = await this.db.select({ cnt: sql`count(*)`.mapWith(Number) })
            .from(this.table)
            .where(eq(this.table.name, name));
        return (rows[0]?.cnt || 0) > 0;
    }

    async getPaged(page = 1, pageSize = 20, search = '', tag = '', sortOrder = 'DESC') {
        const conditions = [];

        if (search) {
            const sp = `%${search}%`;
            conditions.push(
                or(
                    like(this.table.name, sp),
                    like(this.table.proxyStr, sp),
                    like(this.table.tags, sp)
                )
            );
        }
        if (tag) {
            conditions.push(like(this.table.tags, `%"${tag}"%`));
        }

        const where = conditions.length > 0 ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : undefined;

        // Count
        const countRows = await this.db.select({ cnt: sql`count(*)`.mapWith(Number) })
            .from(this.table)
            .where(where);
        const totalCount = countRows[0]?.cnt || 0;

        // Data
        const orderFn = sortOrder === 'ASC' ? asc : desc;
        const offset = (page - 1) * pageSize;

        const query = this.db.select().from(this.table).where(where);
        const rows = await query.orderBy(orderFn(this.table.createdAt)).limit(pageSize).offset(offset);

        return {
            items: rows.map(r => this._rowToProfile(r)),
            totalCount,
            page,
            pageSize,
            totalPages: Math.ceil(totalCount / pageSize),
        };
    }

    async insert(profile) {
        await this.db.insert(this.table).values(this._toDbValues(profile));
    }

    async update(id, profile) {
        const values = this._toDbValues(profile);
        // 不更新 id 和 created_at
        delete values.id;
        delete values.createdAt;
        await this.db.update(this.table).set(values).where(eq(this.table.id, id));
    }

    async delete(id) {
        await this.db.delete(this.table).where(eq(this.table.id, id));
    }

    async upsert(profile) {
        const existing = await this.getById(profile.id);
        if (existing) {
            await this.update(profile.id, profile);
        } else {
            await this.insert(profile);
        }
    }

    async importBatch(profiles) {
        // Drizzle transaction
        await this.db.transaction(async (tx) => {
            for (const p of profiles) {
                const existing = await tx.select().from(this.table).where(eq(this.table.id, p.id)).limit(1);
                if (existing.length > 0) {
                    const values = this._toDbValues(p);
                    delete values.id;
                    delete values.createdAt;
                    await tx.update(this.table).set(values).where(eq(this.table.id, p.id));
                } else {
                    await tx.insert(this.table).values(this._toDbValues(p));
                }
            }
        });
    }

    async getAllTags() {
        const rows = await this.db.select({ tags: this.table.tags }).from(this.table);
        const tagSet = new Set();
        for (const row of rows) {
            try {
                const tags = typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []);
                tags.forEach(t => { if (t) tagSet.add(t); });
            } catch { /* ignore */ }
        }
        return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
    }

    async exportAll() {
        return this.getAll();
    }

    close() {
        if (this._close) {
            this._close();
        }
    }
}

module.exports = { ProfileDB };
