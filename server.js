const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// [중요] MongoDB 연결 (비밀번호 확인하세요!)
const MONGO_URI = "mongodb+srv://koojj321:abcd1234@cluster0.yh4yszy.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DB 연결 성공!'))
    .catch(err => console.error('❌ DB 연결 실패:', err));

// [UPDATED] 유저 스키마 (포인트, 아이템 추가)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    wins: { type: Number, default: 0 },
    loses: { type: Number, default: 0 },
    points: { type: Number, default: 1000 }, // 가입 보너스 1000원
    items: { type: [String], default: ['default'] }, // 보유 아이템
    equipped: { type: String, default: 'default' }   // 장착중인 스킨
});
const User = mongoose.model('User', userSchema);

const BOARD_SIZE = 19;
let rooms = {}; 
let connectedUsers = {}; 

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

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

            // 유저 정보(포인트, 스킨 등) 전송
            socket.emit('loginSuccess', { 
                name, 
                stats: { wins: user.wins, loses: user.loses },
                points: user.points,
                items: user.items,
                equipped: user.equipped
            });

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
        const prices = { 'gold': 500, 'diamond': 1000, 'ruby': 2000 }; // 가격표
        const cost = prices[itemId];

        try {
            const user = await User.findOne({ name: myName });
            if (!user) return;

            if (user.items.includes(itemId)) {
                return socket.emit('alert', '이미 보유한 아이템입니다.');
            }
            if (user.points < cost) {
                return socket.emit('alert', '포인트가 부족합니다!');
            }

            // 구매 처리
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

    // [4] 방 관련 로직
    socket.on('lobbyChat', (msg) => io.emit('lobbyChat', { sender: myName, msg }));

    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방입니다.');
        rooms[roomName] = {
            password, players: [], spectators: [], board: Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)),
            turn: 'black', timerId: null, timeLeft: 30, isPlaying: false, p2Ready: false
        };
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

        // 내 스킨 정보 가져오기
        const user = await User.findOne({ name: myName });
        const mySkin = user ? user.equipped : 'default';

        if (room.players.length < 2 && !room.isPlaying) {
            const color = room.players.length === 0 ? 'black' : 'white';
            const isHost = room.players.length === 0;
            // 플레이어 정보에 스킨(skin) 추가
            room.players.push({ id: socket.id, name: socket.myName, color, isHost, isSpectator: false, skin: mySkin });
            
            socket.emit('roomJoined', { 
                roomName, color, isHost, isSpectator: false, 
                players: room.players, board: room.board 
            });

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

    socket.on('placeStone', ({ x, y }) => {
        const room = rooms[myRoom];
        if (!room || !room.isPlaying) return;
        const me = room.players.find(p => p.id === socket.id);
        if (me.color !== room.turn || room.board[y][x] !== null) return;

        // 보드에 '누구 돌인지' + '어떤 스킨인지' 저장
        // 예: "black:gold" 또는 "white:default"
        const stoneValue = `${me.color}:${me.skin}`;
        room.board[y][x] = stoneValue;
        
        room.turn = room.turn === 'black' ? 'white' : 'black';
        
        // 클라이언트에게 돌 정보 전송
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
        if (connectedUsers[socket.id]) {
            delete connectedUsers[socket.id];
            io.emit('userListUpdate', Object.values(connectedUsers));
        }
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
});

function startTimer(roomName) {
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

    // [UPDATED] 승리 시 포인트 지급 (+100)
    if (winner) await User.updateOne({ name: winner.name }, { $inc: { wins: 1, points: 100 } });
    if (loser) await User.updateOne({ name: loser.name }, { $inc: { loses: 1 } });

    io.to(roomName).emit('gameOver', { msg: `${winnerName} 승리! (+100P)`, winner: winnerName });
    delete rooms[roomName];
    io.emit('roomListUpdate', getRoomList());
    
    // 정보 갱신
    if(winner) { const u = await User.findOne({name: winner.name}); io.to(winner.id).emit('infoUpdate', {wins:u.wins, loses:u.loses, points:u.points}); }
    if(loser) { const u = await User.findOne({name: loser.name}); io.to(loser.id).emit('infoUpdate', {wins:u.wins, loses:u.loses, points:u.points}); }
    
    io.emit('rankingUpdate', await getRankingDB());
}

function getRoomList() { return Object.keys(rooms).map(key => ({ name: key, isLocked: !!rooms[key].password, count: rooms[key].players.length, isPlaying: rooms[key].isPlaying })); }

// [UPDATED] 랭킹: 0승은 제외
async function getRankingDB() { 
    try { 
        return await User.find({ wins: { $gt: 0 } }).sort({ wins: -1 }).limit(5).select('name wins'); 
    } catch { return []; } 
}

function checkWin(board, x, y, stoneValue) {
    // stoneValue는 "black:gold" 형식이므로 색깔만 비교하기 위해 split
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