const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// ---------------------------------------------------------
// 1. MongoDB 연결 및 스키마
// ---------------------------------------------------------
const MONGO_URI = "mongodb+srv://koojj321:abcd1234@cluster0.yh4yszy.mongodb.net/?appName=Cluster0";
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DB 연결 성공!'))
    .catch(err => console.error('❌ DB 연결 실패:', err));

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    wins: { type: Number, default: 0 },
    loses: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    items: { type: [String], default: ['default'] },
    equipped: { type: String, default: 'default' }
});
const User = mongoose.model('User', userSchema);

// ---------------------------------------------------------
// 2. 서버 메모리 데이터
// ---------------------------------------------------------
const BOARD_SIZE = 19;
let rooms = {}; 
let connectedUsers = {}; 
let socketActivity = {}; 

setInterval(checkInactiveUsers, 60000); 

function checkInactiveUsers() {
    const now = Date.now();
    for (const id in socketActivity) {
        if (now - socketActivity[id] > INACTIVITY_TIMEOUT_MS) {
            const socketToDisconnect = io.sockets.sockets.get(id);
            if (socketToDisconnect) {
                socketToDisconnect.emit('force_logout', '30분간 활동이 없어 자동 로그아웃되었습니다.');
                socketToDisconnect.disconnect(true);
            }
            delete socketActivity[id];
            delete connectedUsers[id];
        }
    }
}

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

    socket.on('activity_ping', () => {
        if (socketActivity[socket.id]) socketActivity[socket.id] = Date.now();
    });

    // [1] 로그인
    socket.on('login', async ({ name, password }) => {
        try {
            let user = await User.findOne({ name: name });
            if (user) {
                if (user.password !== password) return socket.emit('loginFail', '비밀번호 불일치');
            } else {
                user = new User({ name, password });
                await user.save();
            }

            myName = name;
            socket.myName = name;
            connectedUsers[socket.id] = name;
            socketActivity[socket.id] = Date.now();

            socket.emit('loginSuccess', { name, stats: { wins: user.wins, loses: user.loses }, points: user.points, items: user.items, equipped: user.equipped });
            socket.emit('roomListUpdate', getRoomList());
            socket.emit('rankingUpdate', await getRankingDB());
            io.emit('userListUpdate', Object.values(connectedUsers));

        } catch (err) {
            console.error(err);
            socket.emit('loginFail', '로그인 오류');
        }
    });

    // [2] 상점 기능 (구매)
    socket.on('buyItem', async (itemId) => {
        const prices = { 'gold': 500, 'diamond': 1000, 'ruby': 2000 }; 
        const cost = prices[itemId];
        try {
            const user = await User.findOne({ name: myName });
            if (!user || user.items.includes(itemId) || user.points < cost) {
                return socket.emit('alert', user ? (user.items.includes(itemId) ? '이미 보유' : '포인트 부족') : '로그인 필요');
            }
            user.points -= cost;
            user.items.push(itemId);
            await user.save();
            socket.emit('shopUpdate', { points: user.points, items: user.items, equipped: user.equipped });
            socket.emit('alert', '구매 성공! 인벤토리에서 장착하세요.');
        } catch (e) { console.error(e); }
    });

    // [3] 상점 기능 (장착)
    socket.on('equipItem', async (itemId) => {
        try {
            const user = await User.findOne({ name: myName });
            if (user && user.items.includes(itemId)) {
                user.equipped = itemId;
                await user.save();
                socket.emit('shopUpdate', { points: user.points, items: user.items, equipped: user.equipped });
            }
        } catch (e) { console.error(e); }
    });

    // [4] 방 생성, 입장, 준비, 시작 로직 (생략)
    socket.on('lobbyChat', (msg) => io.emit('lobbyChat', { sender: myName, msg }));
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방입니다.');
        rooms[roomName] = { password, players: [], spectators: [], board: Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)), turn: 'black', timerId: null, timeLeft: 30, isPlaying: false, p2Ready: false };
        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName];
        if (!room) return socket.emit('error', '존재하지 않는 방입니다.');
        if (room.password && room.password !== password) return socket.emit('error', '비밀번호 오류.');
        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });
    async function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName];
        myRoom = roomName;
        socket.join(roomName);
        const user = await User.findOne({ name: myName });
        const mySkin = user ? user.equipped : 'default';
        if (room.players.length < 2 && !room.isPlaying) {
            const color = room.players.length === 0 ? 'black' : 'white';
            const isHost = room.players.length === 0;
            room.players.push({ id: socket.id, name: socket.myName, color, isHost, isSpectator: false, skin: mySkin });
            socket.emit('roomJoined', { roomName, color, isHost, isSpectator: false, players: room.players, board: room.board });
            if (room.players.length === 2) io.to(roomName).emit('status', '준비되면 시작하세요.');
            else socket.emit('status', '대기중...');
        } else {
            room.spectators.push({ id: socket.id, name: socket.myName, isSpectator: true });
            socket.emit('roomJoined', { roomName, color: null, isHost: false, isSpectator: true, players: room.players, board: room.board });
            socket.emit('status', '관전 모드');
        }
        io.to(roomName).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready });
    }
    socket.on('toggleReady', () => {
        const room = rooms[myRoom];
        if (!room) return;
        const me = room.players.find(p => p.id === socket.id);
        if (!me || me.isHost) return;
        room.p2Ready = !room.p2Ready;
        io.to(myRoom).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready });
    });
    socket.on('startGame', () => {
        const room = rooms[myRoom];
        if (!room) return;
        const me = room.players.find(p => p.id === socket.id);
        if (!me || !me.isHost || room.players.length < 2 || !room.p2Ready) return;
        
        room.isPlaying = true;
        room.board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
        room.turn = 'black';
        io.to(myRoom).emit('gameStart', `게임 시작!`);
        io.emit('roomListUpdate', getRoomList());
        startTimer(myRoom);
    });

    // [5] 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        if (!room.isPlaying) return;
        const me = room.players.find(p => p.id === socket.id);
        if (me.color !== room.turn || room.board[y][x] !== null) return;

        const stoneValue = `${me.color}:${me.skin}`;
        room.board[y][x] = stoneValue;
        room.turn = room.turn === 'black' ? 'white' : 'black';
        io.to(myRoom).emit('updateBoard', { x, y, color: me.color, skin: me.skin });

        if (checkWin(room.board, x, y, stoneValue)) endGame(myRoom, me.name);
        else {
            resetTimer(myRoom);
            const nextName = room.players.find(p => p.color === room.turn).name;
            io.to(myRoom).emit('status', `${nextName} 차례`);
        }
    });

    socket.on('chat', (msg) => { if (myRoom) io.to(myRoom).emit('chat', { sender: myName, msg }); });
    socket.on('leaveRoom', () => handleDisconnect());
    socket.on('disconnect', () => handleDisconnect());

    function handleDisconnect() {
        if (socketActivity[socket.id]) delete socketActivity[socket.id];
        if (connectedUsers[socket.id]) delete connectedUsers[socket.id];
        if (myRoom && rooms[myRoom]) {
            const room = rooms[myRoom];
            const specIndex = room.spectators.findIndex(s => s.id === socket.id);
            if (specIndex !== -1) {
                room.spectators.splice(specIndex, 1);
                io.to(myRoom).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready });
                return;
            }
            stopTimer(myRoom);
            if (room.isPlaying) io.to(myRoom).emit('gameOver', { msg: '상대방이 나갔습니다.', winner: 'opponent' });
            else {
                io.to(myRoom).emit('error', '방이 폭파되었습니다.');
                io.to(myRoom).emit('forceLeave');
            }
            delete rooms[myRoom];
            io.emit('roomListUpdate', getRoomList());
        }
    }
}

// --- 타이머 및 게임 로직 ---
function startTimer(roomName) { /* ... (생략) ... */
    const room = rooms[roomName];
    if(!room) return;
    room.timeLeft = 30;
    io.to(roomName).emit('timerUpdate', room.timeLeft);
    if(room.timerId) clearInterval(room.timerId);
    room.timerId = setInterval(() => {
        room.timeLeft--;
        io.to(roomName).emit('timerUpdate', room.timeLeft);
        if(room.timeLeft <= 0) {
            clearInterval(room.timerId);
            const winner = room.players.find(p => p.color !== room.turn);
            endGame(roomName, winner.name);
        }
    }, 1000);
}
function resetTimer(roomName) { if(rooms[roomName]) { clearInterval(rooms[roomName].timerId); startTimer(roomName); } }
function stopTimer(roomName) { if(rooms[roomName]) clearInterval(rooms[roomName].timerId); }

async function endGame(roomName, winnerName) {
    const room = rooms[roomName];
    stopTimer(roomName);
    const winner = room.players.find(p => p.name === winnerName);
    const loser = room.players.find(p => p.name !== winnerName);
    if (winner) await User.updateOne({ name: winner.name }, { $inc: { wins: 1, points: 100 } });
    if (loser) await User.updateOne({ name: loser.name }, { $inc: { loses: 1 } });
    io.to(roomName).emit('gameOver', { msg: `${winnerName} 승리! (+100P)`, winner: winnerName });
    delete rooms[roomName];
    io.emit('roomListUpdate', getRoomList());
    if(winner) { const u = await User.findOne({name: winner.name}); io.to(winner.id).emit('infoUpdate', {wins:u.wins, loses:u.loses, points:u.points}); }
    if(loser) { const u = await User.findOne({name: loser.name}); io.to(loser.id).emit('infoUpdate', {wins:u.wins, loses:u.loses, points:u.points}); }
    io.emit('rankingUpdate', await getRankingDB());
}

function getRoomList() { return Object.keys(rooms).map(key => ({ name: key, isLocked: !!rooms[key].password, count: rooms[key].players.length, isPlaying: rooms[key].isPlaying })); }
async function getRankingDB() { try { return await User.find({ wins: { $gt: 0 } }).sort({ wins: -1 }).limit(5).select('name wins'); } catch { return []; } }
function checkWin(board, x, y, stoneValue) {
    const color = stoneValue.split(':')[0]; 
    const directions = [[1,0], [0,1], [1,1], [1,-1]];
    for (let [dx, dy] of directions) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
            const target = board[y+dy*i]?.[x+dx*i];
            if (target && target.split(':')[0] === color) count++; else break;
        }
        for (let i = 1; i < 5; i++) {
            const target = board[y-dy*i]?.[x-dx*i];
            if (target && target.split(':')[0] === color) count++; else break;
        }
        if (count >= 5) return true;
    }
    return false;
}

server.listen(PORT, () => console.log(`서버 실행: ${PORT}`));