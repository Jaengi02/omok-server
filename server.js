const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const ai = require('./ai'); // [NEW] AI 로직 불러오기

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// ▼▼▼ 비밀번호 수정 필수! ▼▼▼
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

    socket.on('activity_ping', () => { if (socketActivity[socket.id]) socketActivity[socket.id] = Date.now(); });

    // [로그인]
    socket.on('login', async ({ name, password }) => {
        try {
            let user = await User.findOne({ name: name });
            if (user) {
                if (user.password !== password) return socket.emit('loginFail', '비밀번호 불일치');
            } else {
                user = new User({ name, password });
                await user.save();
            }
            myName = name; socket.myName = name; connectedUsers[socket.id] = name; socketActivity[socket.id] = Date.now();
            socket.emit('loginSuccess', { name, stats: { wins: user.wins, loses: user.loses }, points: user.points, items: user.items, equipped: user.equipped });
            socket.emit('roomListUpdate', getRoomList()); socket.emit('rankingUpdate', await getRankingDB()); io.emit('userListUpdate', Object.values(connectedUsers));
        } catch (err) { console.error(err); socket.emit('loginFail', '로그인 오류'); }
    });

    // [상점]
    socket.on('buyItem', async (itemId) => {
        const prices = { 'gold': 500, 'diamond': 1000, 'ruby': 2000 }; const cost = prices[itemId];
        try {
            const user = await User.findOne({ name: myName });
            if (!user || user.items.includes(itemId) || user.points < cost) {
                return socket.emit('alert', user ? (user.items.includes(itemId) ? '이미 보유' : '포인트 부족') : '로그인 필요');
            }
            user.points -= cost; user.items.push(itemId); await user.save();
            socket.emit('shopUpdate', { points: user.points, items: user.items, equipped: user.equipped });
        } catch (e) { console.error(e); }
    });

    socket.on('equipItem', async (itemId) => {
        try {
            const user = await User.findOne({ name: myName });
            if (user && user.items.includes(itemId)) {
                user.equipped = itemId; await user.save();
                socket.emit('shopUpdate', { points: user.points, items: user.items, equipped: user.equipped });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('lobbyChat', (msg) => { io.emit('lobbyChat', { sender: myName, msg }); });

    // [방 생성 (유저 대결)]
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방입니다.');
        rooms[roomName] = { 
            password, players: [], spectators: [], board: Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)), 
            turn: 'black', timerId: null, timeLeft: 30, isPlaying: false, p2Ready: false, isAiGame: false 
        };
        joinRoomProcess(socket, roomName); io.emit('roomListUpdate', getRoomList());
    });

    // [NEW] AI 대결 방 생성
    socket.on('createAiRoom', (difficulty) => {
        const roomName = `AI전-${myName}-${Date.now()}`; // 유니크한 방 이름
        rooms[roomName] = {
            password: null,
            players: [],
            spectators: [],
            board: Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)),
            turn: 'black',
            timerId: null,
            timeLeft: 99, // AI전은 시간 여유 줌
            isPlaying: true, // 바로 시작
            p2Ready: true,
            isAiGame: true,
            aiDifficulty: difficulty // 'easy', 'medium', 'hard'
        };
        
        // 방장(유저) 입장 처리
        joinRoomProcess(socket, roomName);
    });

    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName]; if (!room) return socket.emit('error', '존재하지 않는 방입니다.');
        if (room.isAiGame) return socket.emit('error', 'AI 방에는 들어갈 수 없습니다.'); // AI방 난입 방지
        if (room.password && room.password !== password) return socket.emit('error', '비밀번호 오류.'); joinRoomProcess(socket, roomName); io.emit('roomListUpdate', getRoomList());
    });

    async function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName]; myRoom = roomName; socket.join(roomName);
        const user = await User.findOne({ name: myName }); const mySkin = user ? user.equipped : 'default';

        // AI 방일 경우 특수 처리
        if (room.isAiGame) {
            room.players.push({ id: socket.id, name: socket.myName, color: 'black', isHost: true, isSpectator: false, skin: mySkin });
            room.players.push({ id: 'AI', name: `AI (${room.aiDifficulty})`, color: 'white', isHost: false, isSpectator: false, skin: 'default' });
            
            socket.emit('roomJoined', { roomName: "AI 대결 (" + room.aiDifficulty + ")", color: 'black', isHost: true, isSpectator: false, players: room.players, board: room.board });
            io.to(roomName).emit('gameStart', `AI 대결 시작! 당신은 흑돌입니다.`);
            return;
        }

        if (room.players.length < 2 && !room.isPlaying) {
            const color = room.players.length === 0 ? 'black' : 'white'; const isHost = room.players.length === 0;
            room.players.push({ id: socket.id, name: socket.myName, color, isHost, isSpectator: false, skin: mySkin });
            socket.emit('roomJoined', { roomName, color, isHost, isSpectator: false, players: room.players, board: room.board });
            if (room.players.length === 2) io.to(roomName).emit('status', '준비되면 시작하세요.'); else socket.emit('status', '대기중...');
        } else {
            room.spectators.push({ id: socket.id, name: socket.myName, isSpectator: true });
            socket.emit('roomJoined', { roomName, color: null, isHost: false, isSpectator: true, players: room.players, board: room.board });
            socket.emit('status', '관전 모드');
        }
        io.to(roomName).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready });
    }

    socket.on('toggleReady', () => {
        const room = rooms[myRoom]; if (!room || room.isAiGame) return; const me = room.players.find(p => p.id === socket.id);
        if (!me || me.isHost) return; room.p2Ready = !room.p2Ready;
        io.to(myRoom).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready });
        io.to(myRoom).emit('status', room.p2Ready ? '준비 완료! 방장님 시작하세요.' : '준비 취소.');
    });
    socket.on('startGame', () => {
        const room = rooms[myRoom]; if (!room || room.isAiGame) return; const me = room.players.find(p => p.id === socket.id);
        if (!me || !me.isHost || room.players.length < 2 || !room.p2Ready) return;
        room.isPlaying = true; room.board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)); room.turn = 'black';
        io.to(myRoom).emit('gameStart', `게임 시작!`); io.emit('roomListUpdate', getRoomList()); startTimer(myRoom);
    });

    // [돌 두기 & AI 로직]
    socket.on('placeStone', ({ x, y }) => {
        const room = rooms[myRoom];
        if (!room || !room.isPlaying) return;
        const me = room.players.find(p => p.id === socket.id);
        // 내 턴이 아니거나(AI턴 포함), 이미 돌이 있으면 무시
        if (me.color !== room.turn || room.board[y][x] !== null) return;

        const stoneValue = `${me.color}:${me.skin}`; 
        room.board[y][x] = stoneValue;
        
        io.to(myRoom).emit('updateBoard', { x, y, color: me.color, skin: me.skin });

        // 유저 승리 체크
        if (checkWin(room.board, x, y, stoneValue)) {
            endGame(myRoom, me.name);
        } else {
            room.turn = 'white'; // AI 턴으로 넘김
            io.to(myRoom).emit('status', 'AI가 생각 중입니다...');

            if (room.isAiGame) {
                // [AI Action] 0.5초 뒤에 AI가 둠
                setTimeout(() => {
                    if(!rooms[myRoom]) return; // 방이 사라졌으면 중단
                    const aiMove = ai.getBestMove(room.board, room.aiDifficulty);
                    const aiY = aiMove.y;
                    const aiX = aiMove.x;
                    
                    const aiStoneValue = `white:default`;
                    room.board[aiY][aiX] = aiStoneValue;
                    room.turn = 'black'; // 다시 유저 턴

                    io.to(myRoom).emit('updateBoard', { x: aiX, y: aiY, color: 'white', skin: 'default' });
                    
                    if (checkWin(room.board, aiX, aiY, aiStoneValue)) {
                        endGame(myRoom, `AI (${room.aiDifficulty})`);
                    } else {
                        io.to(myRoom).emit('status', '당신의 차례입니다.');
                    }
                }, 800);
            } else {
                // 사람 대 사람일 경우 턴 넘기기 및 타이머 리셋
                resetTimer(myRoom);
                const nextName = room.players.find(p => p.color === room.turn).name;
                io.to(myRoom).emit('status', `${nextName} 차례`);
            }
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
            // AI전이면 그냥 방 삭제
            if (room.isAiGame) {
                delete rooms[myRoom];
                io.emit('roomListUpdate', getRoomList());
                return;
            }

            const specIndex = room.spectators.findIndex(s => s.id === socket.id);
            if (specIndex !== -1) { room.spectators.splice(specIndex, 1); io.to(myRoom).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready }); return; }
            
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) { 
                stopTimer(myRoom);
                if (room.isPlaying) io.to(myRoom).emit('gameOver', { msg: `${myName}님이 나갔습니다. 상대방 승리!`, winner: 'opponent' });
                else { io.to(myRoom).emit('error', '방이 폭파되었습니다.'); io.to(myRoom).emit('forceLeave'); }
                delete rooms[myRoom]; io.emit('roomListUpdate', getRoomList());
            }
        }
        io.emit('userListUpdate', Object.values(connectedUsers));
    }
});

// Helper Functions
function startTimer(roomName) {
    const room = rooms[roomName]; if(!room || room.isAiGame) return; // AI전은 타이머 없음
    room.timeLeft = 30; io.to(roomName).emit('timerUpdate', room.timeLeft);
    if(room.timerId) clearInterval(room.timerId);
    room.timerId = setInterval(() => {
        room.timeLeft--; io.to(roomName).emit('timerUpdate', room.timeLeft);
        if(room.timeLeft <= 0) { clearInterval(room.timerId); const winner = room.players.find(p => p.color !== room.turn); if (winner) endGame(roomName, winner.name); }
    }, 1000);
}
function resetTimer(roomName) { if(rooms[roomName] && !rooms[roomName].isAiGame) { clearInterval(rooms[roomName].timerId); startTimer(roomName); } }
function stopTimer(roomName) { if(rooms[roomName]) clearInterval(rooms[roomName].timerId); }

async function endGame(roomName, winnerName) {
    const room = rooms[roomName]; stopTimer(roomName);
    
    // AI 승리 시 처리
    if (winnerName.includes('AI')) {
        io.to(roomName).emit('gameOver', { msg: `AI 승리! (패배)`, winner: 'AI' });
    } else {
        // 유저 승리 (AI전 또는 대인전)
        const winner = room.players.find(p => p.name === winnerName);
        const loser = room.players.find(p => p.name !== winnerName && !p.name.includes('AI'));
        
        // 포인트 보상 계산
        let reward = 100; // 기본 (대인전)
        if (room.isAiGame) {
            if (room.aiDifficulty === 'easy') reward = 50;
            else if (room.aiDifficulty === 'medium') reward = 100;
            else if (room.aiDifficulty === 'hard') reward = 300;
        }

        if (winner) await User.updateOne({ name: winner.name }, { $inc: { wins: 1, points: reward } });
        if (loser) await User.updateOne({ name: loser.name }, { $inc: { loses: 1 } });

        io.to(roomName).emit('gameOver', { msg: `${winnerName} 승리! (+${reward}P)`, winner: winnerName });
        
        if(winner) { const u = await User.findOne({name: winner.name}); io.to(winner.id).emit('infoUpdate', {wins:u.wins, loses:u.loses, points:u.points}); }
    }

    delete rooms[roomName]; io.emit('roomListUpdate', getRoomList());
    io.emit('rankingUpdate', await getRankingDB());
}

function getRoomList() { return Object.keys(rooms).filter(r => !rooms[r].isAiGame).map(key => ({ name: key, isLocked: !!rooms[key].password, count: rooms[key].players.length, isPlaying: rooms[key].isPlaying })); }
async function getRankingDB() { try { return await User.find({ wins: { $gt: 0 } }).sort({ wins: -1 }).limit(5).select('name wins'); } catch { return []; } }
function checkWin(board, x, y, stoneValue) {
    const color = stoneValue.split(':')[0]; const directions = [[1,0], [0,1], [1,1], [1,-1]];
    for (let [dx, dy] of directions) {
        let count = 1;
        for (let i = 1; i < 5; i++) { const target = board[y+dy*i]?.[x+dx*i]; if (target && target.split(':')[0] === color) count++; else break; }
        for (let i = 1; i < 5; i++) { const target = board[y-dy*i]?.[x-dx*i]; if (target && target.split(':')[0] === color) count++; else break; }
        if (count >= 5) return true;
    }
    return false;
}

server.listen(PORT, () => console.log(`서버 실행: ${PORT}`));
