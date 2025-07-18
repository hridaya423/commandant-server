const { WebSocketServer } = require('ws');
const http = require('http');
const RoomManager = require('./rooms');

const PORT = process.env.PORT || 8080;
const FRONTEND_URL = 'https://commandant.hridya.tech';

const server = http.createServer();

const wss = new WebSocketServer({ 
  server,
  cors: {
    origin: FRONTEND_URL,
    credentials: true
  }
});

const roomManager = new RoomManager();

function broadcastToRoom(roomId, message, excludeClient = null) {
  const clients = roomManager.getRoomClients(roomId);
  
  clients.forEach(client => {
    if (client !== excludeClient && client.readyState === 1) { 
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error broadcasting to client:', error);
      }
    }
  });
}

function sendToClient(ws, message) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending to client:', error);
    }
  }
}

wss.on('connection', (ws, request) => {
  console.log('New WebSocket connection from:', request.socket.remoteAddress);

  sendToClient(ws, {
    type: 'connected',
    message: 'Connected to COMMANDANT collaboration server'
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received message:', message.type, message.roomId || '');

      switch (message.type) {
        case 'create_room':
          const newRoomId = roomManager.createRoom();
          sendToClient(ws, {
            type: 'room_created',
            roomId: newRoomId
          });
          break;

        case 'join_room':
          if (message.roomId && message.username) {
            const roomData = roomManager.joinRoom(ws, message.roomId, message.username);
            
            sendToClient(ws, {
              type: 'joined_room',
              roomId: roomData.roomId,
              code: roomData.code,
              users: roomData.users
            });

            const allUsers = roomManager.getRoomUsers(roomData.roomId);
            allUsers.forEach(user => {
              if (user.username !== message.username && user.cursor !== undefined) {
                sendToClient(ws, {
                  type: 'cursor_updated',
                  username: user.username,
                  cursor: user.cursor
                });
              }
            });

            broadcastToRoom(roomData.roomId, {
              type: 'user_joined',
              username: message.username,
              users: roomManager.getRoomUsers(roomData.roomId)
            }, ws);
          }
          break;

        case 'leave_room':
          const leftRoomId = roomManager.leaveRoom(ws);
          if (leftRoomId) {
            broadcastToRoom(leftRoomId, {
              type: 'user_left',
              users: roomManager.getRoomUsers(leftRoomId)
            });
          }
          break;

        case 'code_change':
          if (message.code !== undefined) {
            const result = roomManager.updateCode(ws, message.code, message.version);
            if (result) {
              if (result.conflict) {
                sendToClient(ws, {
                  type: 'code_conflict',
                  serverCode: result.serverCode,
                  serverVersion: result.serverVersion
                });
              } else {
                const session = roomManager.getUserSession(ws);
                broadcastToRoom(result.roomId, {
                  type: 'code_updated',
                  code: message.code,
                  username: session.username,
                  version: result.version
                }, ws);
              }
            }
          }
          break;

        case 'cursor_change':
          if (message.cursor !== undefined) {
            const roomId = roomManager.updateCursor(ws, message.cursor);
            if (roomId) {
              const session = roomManager.getUserSession(ws);
              broadcastToRoom(roomId, {
                type: 'cursor_updated',
                username: session.username,
                cursor: message.cursor
              }, ws);
            }
          }
          break;

        case 'typing_start':
          const typingSession = roomManager.getUserSession(ws);
          if (typingSession) {
            broadcastToRoom(typingSession.roomId, {
              type: 'user_typing',
              username: typingSession.username,
              isTyping: true
            }, ws);
          }
          break;

        case 'typing_stop':
          const stopTypingSession = roomManager.getUserSession(ws);
          if (stopTypingSession) {
            broadcastToRoom(stopTypingSession.roomId, {
              type: 'user_typing',
              username: stopTypingSession.username,
              isTyping: false
            }, ws);
          }
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      sendToClient(ws, {
        type: 'error',
        message: 'Failed to process message'
      });
    }
  });

  ws.on('close', (code, reason) => {
    console.log('WebSocket connection closed:', code, reason.toString());
    const leftRoomId = roomManager.leaveRoom(ws);
    if (leftRoomId) {
      broadcastToRoom(leftRoomId, {
        type: 'user_left',
        users: roomManager.getRoomUsers(leftRoomId)
      });
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      connections: wss.clients.size,
      ...roomManager.getRoomStats()
    }));
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('COMMANDANT Collaboration WebSocket Server');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`endpoint: ws://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});