const { v4: uuidv4 } = require('uuid');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.userSessions = new Map(); 
    
    setInterval(() => {
      this.cleanupInactiveRooms();
    }, 5 * 60 * 1000);
  }

  createRoom() {
    const roomId = uuidv4().slice(0, 8);
    this.rooms.set(roomId, {
      code: `// Welcome to COMMANDANT Collaboration Room: ${roomId}
shout "Mission briefing initiated"

enlist squad_size = 5
enlist supplies = squad_size amplify 10
shout "Squad size: " reinforce squad_size
shout "Total supplies: " reinforce supplies

recon supplies outranks 40:
    shout "Sufficient supplies for mission"
fallback position:
    shout "Request additional supplies"
secure.`,
      users: new Set(),
      lastActivity: new Date(),
      version: 1,
      lastEditBy: null,
      lastEditTime: new Date()
    });
    return roomId;
  }

  joinRoom(ws, roomId, username) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        code: `// Welcome to COMMANDANT Collaboration Room: ${roomId}
shout "Mission briefing initiated"

enlist squad_size = 5`,
        users: new Set(),
        lastActivity: new Date(),
        version: 1,
        lastEditBy: null,
        lastEditTime: new Date()
      });
    }

    this.leaveRoom(ws);

    const room = this.rooms.get(roomId);
    room.users.add(ws);
    room.lastActivity = new Date();

    this.userSessions.set(ws, {
      roomId,
      username,
      cursor: 0
    });

    return {
      roomId,
      code: room.code,
      users: this.getRoomUsers(roomId),
      version: room.version
    };
  }

  leaveRoom(ws) {
    const session = this.userSessions.get(ws);
    if (session) {
      const room = this.rooms.get(session.roomId);
      if (room) {
        room.users.delete(ws);
        room.lastActivity = new Date();
        
        if (room.users.size === 0) {
          this.rooms.delete(session.roomId);
        }
      }
      this.userSessions.delete(ws);
      return session.roomId;
    }
    return null;
  }

  updateCode(ws, code, clientVersion = null) {
    const session = this.userSessions.get(ws);
    if (session) {
      const room = this.rooms.get(session.roomId);
      if (room) {
        if (clientVersion && clientVersion < room.version) {
          console.log(`Version conflict detected: client ${clientVersion} vs server ${room.version}`);
          return { roomId: session.roomId, conflict: true, serverVersion: room.version, serverCode: room.code };
        }
        
        room.code = code;
        room.version += 1;
        room.lastEditBy = session.username;
        room.lastEditTime = new Date();
        room.lastActivity = new Date();
        
        return { roomId: session.roomId, conflict: false, version: room.version };
      }
    }
    return null;
  }

  updateCursor(ws, cursor) {
    const session = this.userSessions.get(ws);
    if (session) {
      session.cursor = cursor;
      const room = this.rooms.get(session.roomId);
      if (room) {
        room.lastActivity = new Date();
        return session.roomId;
      }
    }
    return null;
  }

  getRoomUsers(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const users = [];
    room.users.forEach(ws => {
      const session = this.userSessions.get(ws);
      if (session) {
        users.push({
          username: session.username,
          cursor: session.cursor || 0
        });
      }
    });
    return users;
  }

  getRoomClients(roomId) {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.users) : [];
  }

  getUserSession(ws) {
    return this.userSessions.get(ws);
  }

  cleanupInactiveRooms() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.lastActivity < oneHourAgo) {
        console.log(`Cleaning up inactive room: ${roomId}`);
        
        room.users.forEach(ws => {
          this.userSessions.delete(ws);
          if (ws.readyState === 1) {
            ws.close(1000, 'Room closed due to inactivity');
          }
        });
        
        this.rooms.delete(roomId);
      }
    }
  }

  getRoomStats() {
    return {
      totalRooms: this.rooms.size,
      totalUsers: this.userSessions.size,
      rooms: Array.from(this.rooms.entries()).map(([roomId, room]) => ({
        roomId,
        userCount: room.users.size,
        lastActivity: room.lastActivity
      }))
    };
  }
}

module.exports = RoomManager;