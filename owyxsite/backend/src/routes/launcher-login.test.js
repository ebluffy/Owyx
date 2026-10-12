/**
 * Launcher Login Fallback unit tests (Issue #169).
 * Tests client key enforcement, rate limiting, delay, user enumeration defense,
 * password log avoidance, and session issuance.
 *
 * Run: node --test src/routes/launcher-login.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../database/connection');
const authRouter = require('./auth');
const { resetBuckets } = require('../utils/ipRateLimit');
const { DUMMY_BCRYPT_HASH } = require('../utils/authSecurity');

// Create test express app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.clientIp = '127.0.0.1';
    next();
  });
  app.use('/api/auth', authRouter);
  return app;
}

function startTestServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

describe('Launcher Fallback Login (Issue #169)', () => {
  const TEST_CLIENT_KEY = 'valid-launcher-test-key-xyz123';
  const JWT_SECRET = 'test-jwt-secret-for-launcher-tests';
  const PASSWORD_HASH = bcrypt.hashSync('correct-password-123', 10);

  let prevEnv = {};
  let originalQuery = null;
  let serverHandle = null;
  let mockUser = null;
  let queryLog = [];
  let bcryptCompareCount = 0;
  let originalBcryptCompare = null;

  beforeEach(async () => {
    for (const k of [
      'LAUNCHER_CLIENT_KEY',
      'JWT_SECRET',
      'NODE_ENV',
      'LAUNCHER_LOGIN_DELAY_MS',
      'TURNSTILE_SECRET_KEY',
      'TURNSTILE_SKIP',
    ]) {
      prevEnv[k] = process.env[k];
    }

    process.env.LAUNCHER_CLIENT_KEY = TEST_CLIENT_KEY;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = 'test';
    process.env.LAUNCHER_LOGIN_DELAY_MS = '0'; // 0 for fast tests unless testing delay specifically
    delete process.env.TURNSTILE_SKIP;
    delete process.env.TURNSTILE_SECRET_KEY;

    resetBuckets();
    queryLog = [];
    bcryptCompareCount = 0;

    originalBcryptCompare = bcrypt.compare;
    bcrypt.compare = async function (...args) {
      bcryptCompareCount++;
      return originalBcryptCompare.apply(this, args);
    };

    mockUser = {
      id: 42,
      nickname: 'Steve',
      display_nickname: 'Steve Owyx',
      email: 'steve@owyx.test',
      password_hash: PASSWORD_HASH,
      role: 'user',
      is_active: true,
      is_banned: false,
      is_email_verified: true,
      registered_at: new Date().toISOString(),
    };

    originalQuery = db.query;
    db.query = async (text, params) => {
      queryLog.push({ text: String(text), params });

      // checkLoginAttempts
      if (/COUNT\(\*\)\s+as\s+attempts/i.test(String(text))) {
        return { rows: [{ attempts: 0 }], rowCount: 1 };
      }

      // User lookup by email or nickname
      if (/SELECT\s+\*\s+FROM\s+users\s+WHERE/i.test(String(text))) {
        if (!mockUser) {
          return { rows: [], rowCount: 0 };
        }
        const param = (params?.[0] || '').toLowerCase();
        if (
          param === mockUser.email.toLowerCase() ||
          param === mockUser.nickname.toLowerCase()
        ) {
          return { rows: [{ ...mockUser }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // Session cleanup
      if (/DELETE\s+FROM\s+user_sessions\s+WHERE\s+expires_at/i.test(String(text))) {
        return { rows: [], rowCount: 0 };
      }

      // Existing sessions for capping
      if (/SELECT\s+id\s+FROM\s+user_sessions/i.test(String(text))) {
        return { rows: [], rowCount: 0 };
      }

      // Session insert
      if (/INSERT\s+INTO\s+user_sessions/i.test(String(text))) {
        return { rows: [], rowCount: 1 };
      }

      // Update last_login
      if (/UPDATE\s+users\s+SET\s+last_login/i.test(String(text))) {
        return { rows: [], rowCount: 1 };
      }

      // Login logs
      if (/INSERT\s+INTO\s+login_logs/i.test(String(text))) {
        return { rows: [], rowCount: 1 };
      }

      // User activity log
      if (/INSERT\s+INTO\s+user_activity/i.test(String(text))) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    };

    serverHandle = await startTestServer(createTestApp());
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
    if (originalQuery) {
      db.query = originalQuery;
      originalQuery = null;
    }
    if (originalBcryptCompare) {
      bcrypt.compare = originalBcryptCompare;
      originalBcryptCompare = null;
    }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetBuckets();
  });

  describe('Client Key Gate', () => {
    it('rejects launcher login without X-Owyx-Client-Key', async () => {
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'Steve', password: 'correct-password-123' }),
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'unauthorized_client');
    });

    it('rejects launcher login with incorrect X-Owyx-Client-Key', async () => {
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': 'wrong-key-value',
        },
        body: JSON.stringify({ login: 'Steve', password: 'correct-password-123' }),
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'unauthorized_client');
    });

    it('returns 503 in production if LAUNCHER_CLIENT_KEY is missing on server', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LAUNCHER_CLIENT_KEY;

      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': 'any-key',
        },
        body: JSON.stringify({ login: 'Steve', password: 'correct-password-123' }),
      });
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.equal(json.error, 'launcher_client_key_missing');
    });
  });

  describe('Existing /api/auth/login Route Preservation', () => {
    it('never bypasses Turnstile on existing /api/auth/login even with valid client key', async () => {
      process.env.NODE_ENV = 'production';
      process.env.TURNSTILE_SECRET_KEY = 'secret-turnstile';

      const res = await fetch(`${serverHandle.url}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({
          login: 'Steve',
          password: 'correct-password-123',
          // No turnstileToken provided
        }),
      });

      // Must be 400 rejection due to missing/invalid captcha
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /капч/i);
    });
  });

  describe('Input Validation & Password Sanitization', () => {
    it('rejects missing login and does not echo password', async () => {
      const sensitivePassword = 'SecretP@ssword99!';
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ password: sensitivePassword }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Ошибка валидации');
      const text = JSON.stringify(json);
      assert.equal(text.includes(sensitivePassword), false, 'Password must not be in response body');
    });

    it('rejects short password and strips value from validation error details', async () => {
      const shortPass = '123';
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: shortPass }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Ошибка валидации');
      assert.ok(Array.isArray(json.details));
      for (const err of json.details) {
        assert.equal(err.value, undefined, 'Field "value" must be omitted from error details');
      }
      assert.equal(JSON.stringify(json).includes(shortPass), false);
    });

    it('rejects password exceeding 72 bytes', async () => {
      const longPass = 'A'.repeat(80);
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: longPass }),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Ошибка валидации');
      assert.equal(JSON.stringify(json).includes(longPass), false);
    });
  });

  describe('User Enumeration & Timing Defense', () => {
    it('returns identical 401 response and calls bcrypt compare when user does not exist', async () => {
      mockUser = null; // User not found in DB

      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'NonExistentUser', password: 'wrong-password-999' }),
      });

      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'Неверный логин или пароль');

      // Crucial: bcrypt.compare must have been called against DUMMY_BCRYPT_HASH to equalize timing
      assert.equal(bcryptCompareCount, 1);
    });

    it('returns identical 401 response and calls bcrypt compare when password is wrong', async () => {
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: 'wrong-password-999' }),
      });

      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'Неверный логин или пароль');
      assert.equal(bcryptCompareCount, 1);
    });

    it('does not leak banned status when password is wrong', async () => {
      mockUser.is_banned = true;

      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: 'wrong-password-999' }),
      });

      // Must NOT return 403 (banned) when password was wrong!
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'Неверный логин или пароль');
    });

    it('does not leak inactive status when password is wrong', async () => {
      mockUser.is_active = false;

      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: 'wrong-password-999' }),
      });

      // Must NOT return 403 (inactive) when password was wrong!
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error, 'Неверный логин или пароль');
    });
  });

  describe('Account Status Enforcement with Valid Credentials', () => {
    it('returns 403 when password is correct but user is banned', async () => {
      mockUser.is_banned = true;

      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: 'correct-password-123' }),
      });

      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error, 'Аккаунт заблокирован');
    });

    it('returns 403 when password is correct but user is inactive', async () => {
      mockUser.is_active = false;

      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: 'correct-password-123' }),
      });

      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error, 'Аккаунт неактивен');
    });
  });

  describe('Rate Limiting', () => {
    it('enforces strict account rate limit (max 5 per 15 min)', async () => {
      // 5 failed attempts allowed
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Owyx-Client-Key': TEST_CLIENT_KEY,
          },
          body: JSON.stringify({ login: 'Steve', password: 'wrong-password' }),
        });
        assert.equal(res.status, 401);
      }

      // 6th attempt should trigger 429
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: 'wrong-password' }),
      });
      assert.equal(res.status, 429);
      const json = await res.json();
      assert.match(json.error, /Слишком много попыток/);
      assert.ok(json.retryAfterSec > 0);
    });

    it('enforces strict IP rate limit (max 10 per 15 min across different accounts)', async () => {
      // 10 attempts on different user accounts
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Owyx-Client-Key': TEST_CLIENT_KEY,
          },
          body: JSON.stringify({ login: `User_${i}`, password: 'wrong-password' }),
        });
        assert.equal(res.status, 401);
      }

      // 11th attempt from same IP should trigger IP rate limit
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'User_New', password: 'wrong-password' }),
      });
      assert.equal(res.status, 429);
      const json = await res.json();
      assert.match(json.error, /IP-адреса/);
      assert.ok(json.retryAfterSec > 0);
    });

  });

  describe('Artificial Delay Execution', () => {
    it('applies configured artificial delay', async () => {
      process.env.LAUNCHER_LOGIN_DELAY_MS = '60'; // 60ms delay
      const start = Date.now();

      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({ login: 'Steve', password: 'wrong-password' }),
      });

      const elapsed = Date.now() - start;
      assert.equal(res.status, 401);
      assert.ok(elapsed >= 50, `Expected elapsed (${elapsed}ms) to be at least 50ms`);
    });
  });

  describe('Successful Login & Session Management', () => {
    it('issues valid JWT and returns public user on correct credentials', async () => {
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({
          login: 'Steve',
          password: 'correct-password-123',
          remember: true,
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.message, 'Успешная авторизация');
      assert.ok(json.token, 'Must return JWT token');

      // Verify token
      const decoded = jwt.verify(json.token, JWT_SECRET);
      assert.equal(decoded.userId, mockUser.id);
      assert.equal(decoded.email, mockUser.email);

      // Verify user object is sanitized and does not leak password_hash
      assert.equal(json.user.id, mockUser.id);
      assert.equal(json.user.nickname, mockUser.nickname);
      assert.equal(json.user.password_hash, undefined, 'password_hash must not be present');

      // Check session insertion and activity logging occurred
      const sessionInsert = queryLog.find((q) => /INSERT\s+INTO\s+user_sessions/i.test(q.text));
      assert.ok(sessionInsert, 'user_sessions row must be inserted');

      const activityInsert = queryLog.find((q) => /INSERT\s+INTO\s+user_activity/i.test(q.text));
      assert.ok(activityInsert, 'user_activity row must be logged');

      // Verify password was NEVER logged in queries
      for (const q of queryLog) {
        assert.equal(
          JSON.stringify(q.params || []).includes('correct-password-123'),
          false,
          'Password must never be in DB query parameters'
        );
      }
    });

    it('accepts email as alias for login', async () => {
      const res = await fetch(`${serverHandle.url}/api/auth/launcher/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owyx-Client-Key': TEST_CLIENT_KEY,
        },
        body: JSON.stringify({
          email: 'steve@owyx.test',
          password: 'correct-password-123',
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.user.nickname, 'Steve');
    });
  });
});
