import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const db = require('../database/connection');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sessionTokenHashes } = require('../utils/authSecurity');

interface AuthedSocket extends Socket {
  user?: {
    id: number;
    nickname: string;
    role: string;
    avatar_url?: string;
  };
  sessionId?: number;
  sessionToken?: string;
  lastAuthCheckAt?: number;
}

let ioRef: Server | null = null;

const AUTH_RECHECK_MS = 30_000;

async function sessionStillValid(
  userId: number,
  sessionId: number | undefined,
  token: string | undefined
): Promise<boolean> {
  if (!sessionId || !token) return false;
  const result = await db.query(
    `SELECT u.id, u.is_active, u.is_banned, s.is_active AS session_active, s.expires_at
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1
       AND s.user_id = $2
       AND s.token_hash = ANY($3::text[])
       AND s.is_active = true
       AND s.expires_at > NOW()`,
    [sessionId, userId, sessionTokenHashes(token)]
  );
  const row = result.rows[0];
  if (!row) return false;
  if (row.is_active === false || row.is_banned === true || row.session_active === false) {
    return false;
  }
  return true;
}

async function assertSocketAuthorized(socket: AuthedSocket): Promise<boolean> {
  if (!socket.user) return false;
  const now = Date.now();
  if (socket.lastAuthCheckAt && now - socket.lastAuthCheckAt < 2_000) {
    // Allow burst of events within 2s after a recent successful check.
    return true;
  }
  const ok = await sessionStillValid(socket.user.id, socket.sessionId, socket.sessionToken);
  socket.lastAuthCheckAt = now;
  if (!ok) {
    socket.emit('session_revoked', { reason: 'Session expired or revoked' });
    socket.disconnect(true);
    return false;
  }
  return true;
}

/** Disconnect live sockets for a user (logout / ban / password reset). */
export function disconnectUserSockets(
  userId: number,
  reason = 'credentials_revoked',
  keepSessionId?: number | null
) {
  if (!ioRef) return;
  for (const socket of ioRef.sockets.sockets.values()) {
    const authed = socket as AuthedSocket;
    if (authed.user?.id !== userId) continue;
    if (keepSessionId != null && authed.sessionId === Number(keepSessionId)) {
      continue;
    }
    authed.emit('session_revoked', { reason });
    authed.disconnect(true);
  }
}

export function initSocket(httpServer: HttpServer) {
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : process.env.NODE_ENV === 'production'
      ? [process.env.FRONTEND_URL || 'https://owyx.site']
      : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001'];

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    path: '/socket.io',
  });
  ioRef = io;

  /** Per-user chat send buckets (in-process; resets on restart). */
  const chatSendBuckets = new Map<string, { start: number; count: number }>();
  function allowChatSend(userId: number): boolean {
    const windowMs = 60_000;
    const max = 20;
    const now = Date.now();
    const key = String(userId);
    let entry = chatSendBuckets.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      chatSendBuckets.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= max;
  }

  io.use(async (socket: AuthedSocket, next) => {
    try {
      const token =
        socket.handshake.auth && (socket.handshake.auth as { token?: string }).token;

      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication required'));
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error('Server misconfigured'));

      const decoded = jwt.verify(token, secret) as { userId: number };
      const result = await db.query(
        `SELECT u.id, u.nickname, u.role, u.avatar_url, u.is_active, u.is_banned,
                s.id AS session_id
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ANY($1::text[])
           AND s.user_id = $2
           AND s.is_active = true
           AND s.expires_at > NOW()`,
        [sessionTokenHashes(token), decoded.userId]
      );

      if (result.rows.length === 0 || !result.rows[0].is_active || result.rows[0].is_banned) {
        return next(new Error('User not found or banned'));
      }

      socket.user = {
        id: result.rows[0].id,
        nickname: result.rows[0].nickname,
        role: result.rows[0].role || 'user',
        avatar_url: result.rows[0].avatar_url,
      };
      socket.sessionId = Number(result.rows[0].session_id);
      socket.sessionToken = token;
      socket.lastAuthCheckAt = Date.now();
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    console.log(`Socket connected: ${socket.user?.nickname} (${socket.id})`);

    const recheckTimer = setInterval(() => {
      void assertSocketAuthorized(socket);
    }, AUTH_RECHECK_MS);
    socket.on('disconnect', () => {
      clearInterval(recheckTimer);
      console.log(`Socket disconnected: ${socket.user?.nickname}`);
    });

    socket.on('join_room', async (roomId: number | string, cb?: (res: unknown) => void) => {
      try {
        if (!(await assertSocketAuthorized(socket))) {
          cb?.({ error: 'Session expired' });
          return;
        }
        const id = parseInt(String(roomId), 10);
        if (!Number.isFinite(id)) {
          cb?.({ error: 'Invalid room id' });
          return;
        }

        const access = await db.query(
          `SELECT r.is_private, (rm.user_id IS NOT NULL) AS is_member
           FROM chat_rooms r
           LEFT JOIN chat_room_members rm ON rm.room_id = r.id AND rm.user_id = $2
           WHERE r.id = $1`,
          [id, socket.user!.id]
        );
        const room = access.rows[0];
        if (!room || (room.is_private && !room.is_member)) {
          cb?.({ error: 'Room not found or access denied' });
          return;
        }

        await db.query(
          `INSERT INTO chat_room_members (room_id, user_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, socket.user!.id]
        );

        socket.join(`room:${id}`);
        socket.to(`room:${id}`).emit('user_joined', {
          roomId: id,
          user: socket.user,
        });
        cb?.({ success: true, roomId: id });
      } catch (error: any) {
        console.error('join_room error:', error.message);
        cb?.({ error: error.message });
      }
    });

    socket.on('leave_room', (roomId: number | string) => {
      const id = parseInt(String(roomId), 10);
      socket.leave(`room:${id}`);
      socket.to(`room:${id}`).emit('user_left', {
        roomId: id,
        user: socket.user,
      });
    });

    socket.on(
      'send_message',
      async (
        payload: { roomId: number; content: string },
        cb?: (res: unknown) => void
      ) => {
        try {
          if (!(await assertSocketAuthorized(socket))) {
            cb?.({ error: 'Session expired' });
            return;
          }
          const roomId = parseInt(String(payload.roomId), 10);
          const content = String(payload.content || '').trim();
          if (!Number.isFinite(roomId) || !content || content.length > 2000) {
            cb?.({ error: 'Invalid message' });
            return;
          }
          if (!socket.rooms.has(`room:${roomId}`)) {
            cb?.({ error: 'Join the room before sending messages' });
            return;
          }

          // Re-check private room membership (membership may have been revoked).
          const access = await db.query(
            `SELECT r.is_private, (rm.user_id IS NOT NULL) AS is_member
             FROM chat_rooms r
             LEFT JOIN chat_room_members rm ON rm.room_id = r.id AND rm.user_id = $2
             WHERE r.id = $1`,
            [roomId, socket.user!.id]
          );
          const room = access.rows[0];
          if (!room || (room.is_private && !room.is_member)) {
            socket.leave(`room:${roomId}`);
            cb?.({ error: 'Room not found or access denied' });
            return;
          }

          if (!allowChatSend(socket.user!.id)) {
            cb?.({ error: 'Too many messages, slow down' });
            return;
          }

          const insert = await db.query(
            `INSERT INTO chat_messages (room_id, user_id, content)
             VALUES ($1, $2, $3)
             RETURNING id, room_id, user_id, content, created_at`,
            [roomId, socket.user!.id, content]
          );

          const message = {
            ...insert.rows[0],
            nickname: socket.user!.nickname,
            avatar_url: socket.user!.avatar_url,
            role: socket.user!.role,
          };

          io.to(`room:${roomId}`).emit('new_message', message);
          cb?.({ success: true, message });
        } catch (error: any) {
          console.error('send_message error:', error.message);
          cb?.({ error: error.message });
        }
      }
    );

    socket.on('typing', (payload: { roomId: number; isTyping: boolean }) => {
      const roomId = parseInt(String(payload.roomId), 10);
      if (!socket.rooms.has(`room:${roomId}`)) return;
      socket.to(`room:${roomId}`).emit('typing', {
        roomId,
        user: socket.user,
        isTyping: !!payload.isTyping,
      });
    });
  });

  return io;
}
