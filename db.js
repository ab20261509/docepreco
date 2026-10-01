const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

// Detectar se está configurado para Turso remoto ou fallback local
const tursoUrl = (process.env.TURSO_DATABASE_URL || '').trim();
const tursoAuthToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

let clientConfig;
if (tursoUrl) {
  clientConfig = {
    url: tursoUrl,
    authToken: tursoAuthToken
  };
} else {
  const localDbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'confeitaria.db');
  const dir = path.dirname(localDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Normalizar para path absoluto seguro no formato file:
  const absPath = path.resolve(localDbPath).replace(/\\/g, '/');
  clientConfig = {
    url: `file:${absPath}`
  };
}

const client = createClient(clientConfig);

// Normalizador de argumentos para garantir arrays simples
function normalizarArgs(args) {
  if (args === undefined || args === null) return [];
  if (Array.isArray(args)) return args;
  return [args];
}

const db = {
  client,
  isTurso: Boolean(tursoUrl),

  // Executa query SELECT e retorna lista de objetos JS
  async all(sql, args = []) {
    const res = await client.execute({ sql, args: normalizarArgs(args) });
    return res.rows.map(r => Object.assign({}, r));
  },

  // Executa query SELECT e retorna a primeira linha ou null
  async get(sql, args = []) {
    const res = await client.execute({ sql, args: normalizarArgs(args) });
    if (!res.rows || res.rows.length === 0) return null;
    return Object.assign({}, res.rows[0]);
  },

  // Executa INSERT/UPDATE/DELETE e retorna { lastInsertRowid, changes }
  async run(sql, args = []) {
    const res = await client.execute({ sql, args: normalizarArgs(args) });
    return {
      lastInsertRowid: res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
        ? Number(res.lastInsertRowid)
        : 0,
      changes: res.rowsAffected || 0
    };
  },

  // Executa múltiplos comandos DDL
  async exec(sql) {
    if (typeof client.executeMultiple === 'function') {
      await client.executeMultiple(sql);
    } else {
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      for (const stmt of statements) {
        await client.execute(stmt);
      }
    }
  },

  // Executa transação atômica assíncrona
  async transaction(fn) {
    const tx = await client.transaction('write');
    const txAdapter = {
      async all(sql, args = []) {
        const res = await tx.execute({ sql, args: normalizarArgs(args) });
        return res.rows.map(r => Object.assign({}, r));
      },
      async get(sql, args = []) {
        const res = await tx.execute({ sql, args: normalizarArgs(args) });
        if (!res.rows || res.rows.length === 0) return null;
        return Object.assign({}, res.rows[0]);
      },
      async run(sql, args = []) {
        const res = await tx.execute({ sql, args: normalizarArgs(args) });
        return {
          lastInsertRowid: res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
            ? Number(res.lastInsertRowid)
            : 0,
          changes: res.rowsAffected || 0
        };
      },
      async exec(sql) {
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
        for (const stmt of statements) {
          await tx.execute(stmt);
        }
      }
    };

    try {
      const result = await fn(txAdapter);
      await tx.commit();
      return result;
    } catch (err) {
      try { await tx.rollback(); } catch (_) {}
      throw err;
    }
  },

  // Runner de Migrações Versionadas
  async rodarMigracoes() {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS _migracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        arquivo TEXT NOT NULL UNIQUE,
        executada_em TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) return;

    const arquivos = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const resJaExecutadas = await client.execute('SELECT arquivo FROM _migracoes');
    const jaExecutadas = new Set(resJaExecutadas.rows.map(r => r.arquivo));

    for (const arq of arquivos) {
      if (!jaExecutadas.has(arq)) {
        const sql = fs.readFileSync(path.join(migrationsDir, arq), 'utf8');
        const statements = sql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        for (const stmt of statements) {
          try {
            await client.execute(stmt);
          } catch (err) {
            if (err.message && err.message.includes('duplicate column name')) {
              continue;
            }
            throw err;
          }
        }

        await client.execute({
          sql: 'INSERT INTO _migracoes (arquivo) VALUES (?)',
          args: [arq]
        });

        console.log(`📦 [Turso/Migrações] Aplicada com sucesso: ${arq}`);
      }
    }
  },

  // Store para express-session gravando na tabela sessions do Turso
  createSessionStore(session) {
    const Store = session.Store;
    class LibSqlSessionStore extends Store {
      constructor() {
        super();
      }

      async get(sid, cb) {
        try {
          const res = await client.execute({
            sql: 'SELECT sess, expire FROM sessions WHERE sid = ?',
            args: [sid]
          });
          if (!res.rows || res.rows.length === 0) {
            return cb(null, null);
          }
          const row = res.rows[0];
          if (row.expire && new Date(row.expire) < new Date()) {
            await client.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] });
            return cb(null, null);
          }
          const sessData = JSON.parse(row.sess);
          cb(null, sessData);
        } catch (err) {
          cb(err);
        }
      }

      async set(sid, sess, cb) {
        try {
          const sessStr = JSON.stringify(sess);
          const maxAge = (sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 86400000 * 7;
          const expire = new Date(Date.now() + maxAge).toISOString();
          
          await client.execute({
            sql: `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
                  ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
            args: [sid, sessStr, expire]
          });
          if (cb) cb(null);
        } catch (err) {
          if (cb) cb(err);
        }
      }

      async destroy(sid, cb) {
        try {
          await client.execute({
            sql: 'DELETE FROM sessions WHERE sid = ?',
            args: [sid]
          });
          if (cb) cb(null);
        } catch (err) {
          if (cb) cb(err);
        }
      }

      async touch(sid, sess, cb) {
        try {
          const maxAge = (sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 86400000 * 7;
          const expire = new Date(Date.now() + maxAge).toISOString();
          await client.execute({
            sql: 'UPDATE sessions SET expire = ? WHERE sid = ?',
            args: [expire, sid]
          });
          if (cb) cb(null);
        } catch (err) {
          if (cb) cb(err);
        }
      }
    }

    return new LibSqlSessionStore();
  }
};

module.exports = db;
