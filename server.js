const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose'); // 데이터베이스 도구

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// ---------------------------------------------------------
// 1. MongoDB 연결 (가장 중요!)
// ---------------------------------------------------------
// ▼▼▼ 아래 "여기에비밀번호입력"을 진짜 비밀번호로 바꾸세요! ▼▼▼
const MONGO_URI = "mongodb+srv://koojj321:koo020110@cluster0.yh4yszy.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ 데이터베이스(MongoDB) 연결 성공!'))
    .catch(err => {
        console.error('❌ DB 연결 실패! 비밀번호가 맞는지 확인하세요.');
        console.error(err);
    });

// 유저 스키마 (데이터 설계도)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    wins: { type: Number, default: 0 },
    loses: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// ---------------------------------------------------------
// 2. 서버 메모리 데이터
// ---------------------------------------------------------
const BOARD_SIZE = 19; // 19줄 바둑판
let rooms = {}; 
let connectedUsers = {}; 

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

    // [1] 로그인 (DB 연동)
    socket.on('login', async ({ name, password }) => {
        try {
            // DB에서 유저 찾기
            let user = await User.findOne({ name: name });

            if (user) {
                // 기존 유저라면 비밀번호 체크
                if (user.password !== password) {
                    return socket.emit('loginFail', '비밀번호가 틀렸습니다!');
                }
            } else {
                // 신규 유저라면 DB에 저장 (회원가입)
                user = new User({ name, password, wins: 0, loses: 0 });
                await user.save();
            }

            myName = name;
            socket.myName = name;
            connectedUsers[socket.id] = name; // 접속자 명단 추가

            socket.emit('loginSuccess', { name, stats: { wins: user.wins, loses: user.loses } });
            socket.emit('roomListUpdate', getRoomList());
            
            // 랭킹은 DB에서 가져와서 보냄
            const ranking = await getRankingDB();
            socket.emit('rankingUpdate', ranking);
            
            io.emit('userListUpdate', Object.values(connectedUsers));

        } catch (err) {
            console.error(err);
            socket.emit('loginFail', '로그인 중 오류가 발생했습니다.');
        }
    });

    // [2] 대기실 채팅
    socket.on('lobbyChat', (msg) => {
        io.emit('lobbyChat', { sender: myName, msg: msg });
    });

    // [3] 방 만들기
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방입니다.');

        rooms[roomName] = {
            password,
            players: [],
            spectators: [],
            board: Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)),
            turn: 'black',
            timerId: null,
            timeLeft: 30,
            isPlaying: false,
            p2Ready: false
        };

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    // [4] 방 입장
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName];
        if (!room) return socket.emit('error', '존재하지 않는 방입니다.');
        if (room.password && room.password !== password) return socket.emit('error', '비밀번호 오류.');

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName];
        myRoom = roomName;
        socket.join(roomName);

        // 플레이어 자리 남았고, 게임 중 아니면 -> 선수 입장
        if (room.players.length < 2 && !room.isPlaying) {
            const color = room.players.length === 0 ? 'black' : 'white';
            const isHost = room.players.length === 0;
            room.players.push({ id: socket.id, name: socket.myName, color, isHost, isSpectator: false });
            
            socket.emit('roomJoined', { 
                roomName, color, isHost, isSpectator: false, 
                players: room.players, board: room.board 
            });

            if (room.players.length === 2) io.to(roomName).emit('status', '참여자가 준비하면 시작할 수 있습니다.');
            else socket.emit('status', '상대방을 기다리는 중...');
        } else {
            // 자리 없거나 게임 중이면 -> 관전자로 입장
            room.spectators.push({ id: socket.id, name: socket.myName, isSpectator: true });
            socket.emit('roomJoined', { 
                roomName, color: null, isHost: false, isSpectator: true, 
                players: room.players, board: room.board 
            });
            socket.emit('status', '관전 모드입니다.');
        }

        io.to(roomName).emit('updateRoomInfo', { 
            players: room.players, spectators: room.spectators, p2Ready: room.p2Ready 
        });
    }

    // [5] 준비 완료
    socket.on('toggleReady', () => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        const me = room.players.find(p => p.id === socket.id);
        if (!me || me.isHost || me.isSpectator) return;

        room.p2Ready = !room.p2Ready;
        io.to(myRoom).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready });
        io.to(myRoom).emit('status', room.p2Ready ? '준비 완료! 방장님 시작하세요.' : '준비 취소.');
    });

    // [6] 게임 시작
    socket.on('startGame', () => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        const me = room.players.find(p => p.id === socket.id);
        
        if (!me || !me.isHost) return;
        if (room.players.length < 2 || !room.p2Ready) return socket.emit('error', '시작할 수 없습니다.');

        room.isPlaying = true;
        room.board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null)); // 보드 초기화
        room.turn = 'black';

        io.to(myRoom).emit('gameStart', `게임 시작! ${room.players[0].name}(흑) 차례`);
        io.emit('roomListUpdate', getRoomList());
        startTimer(myRoom);
    });

    // [7] 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        if (!room.isPlaying) return;

        const me = room.players.find(p => p.id === socket.id);
        if (!me || me.isSpectator) return;
        if (me.color !== room.turn || room.board[y][x] !== null) return;

        room.board[y][x] = me.color;
        room.turn = room.turn === 'black' ? 'white' : 'black';

        io.to(myRoom).emit('updateBoard', { x, y, color: me.color });

        if (checkWin(room.board, x, y, me.color)) {
            endGame(myRoom, me.name);
        } else {
            resetTimer(myRoom);
            const nextName = room.players.find(p => p.color === room.turn).name;
            io.to(myRoom).emit('status', `${nextName} 님의 차례`);
        }
    });

    // [8] 게임 채팅
    socket.on('chat', (msg) => { 
        if (myRoom && rooms[myRoom]) io.to(myRoom).emit('chat', { sender: myName, msg }); 
    });

    // [9] 나가기 처리
    socket.on('leaveRoom', () => handleDisconnect());
    socket.on('disconnect', () => handleDisconnect());

    function handleDisconnect() {
        // 접속자 명단에서 제거
        if (socket.id in connectedUsers) {
            delete connectedUsers[socket.id];
            io.emit('userListUpdate', Object.values(connectedUsers));
        }

        if (myRoom && rooms[myRoom]) {
            const room = rooms[myRoom];
            
            // 관전자가 나간 경우
            const specIndex = room.spectators.findIndex(s => s.id === socket.id);
            if (specIndex !== -1) {
                room.spectators.splice(specIndex, 1);
                io.to(myRoom).emit('updateRoomInfo', { players: room.players, spectators: room.spectators, p2Ready: room.p2Ready });
                return;
            }

            // 플레이어가 나간 경우
            stopTimer(myRoom);
            if (room.isPlaying) {
                io.to(myRoom).emit('gameOver', { msg: `${myName}님이 나갔습니다. 상대방 승리!`, winner: 'opponent' });
            } else {
                io.to(myRoom).emit('error', '플레이어가 나가서 방이 폭파됩니다.');
                io.to(myRoom).emit('forceLeave');
            }
            delete rooms[myRoom];
            io.emit('roomListUpdate', getRoomList());
        }
    }
});

// --- 타이머 및 게임 로직 ---
function startTimer(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    room.timeLeft = 30;
    io.to(roomName).emit('timerUpdate', room.timeLeft);
    if (room.timerId) clearInterval(room.timerId);
    
    room.timerId = setInterval(() => {
        room.timeLeft--;
        io.to(roomName).emit('timerUpdate', room.timeLeft);
        if (room.timeLeft <= 0) {
            clearInterval(room.timerId);
            const loserColor = room.turn;
            const winner = room.players.find(p => p.color !== loserColor);
            if (winner) endGame(roomName, winner.name);
        }
    }, 1000);
}

function resetTimer(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    clearInterval(room.timerId);
    startTimer(roomName);
}
function stopTimer(roomName) {
    if (rooms[roomName] && rooms[roomName].timerId) clearInterval(rooms[roomName].timerId);
}

// [게임 종료 및 DB 업데이트]
async function endGame(roomName, winnerName) {
    const room = rooms[roomName];
    if (!room) return;
    stopTimer(roomName);

    const winner = room.players.find(p => p.name === winnerName);
    const loser = room.players.find(p => p.name !== winnerName);

    // MongoDB 업데이트
    if (winner) await User.updateOne({ name: winner.name }, { $inc: { wins: 1 } });
    if (loser) await User.updateOne({ name: loser.name }, { $inc: { loses: 1 } });

    // 업데이트된 전적 클라이언트에 전송
    if (winner) {
        const wInfo = await User.findOne({ name: winner.name });
        io.to(winner.id).emit('statsUpdate', { wins: wInfo.wins, loses: wInfo.loses });
    }
    if (loser) {
        const lInfo = await User.findOne({ name: loser.name });
        io.to(loser.id).emit('statsUpdate', { wins: lInfo.wins, loses: lInfo.loses });
    }

    io.to(roomName).emit('gameOver', { msg: `${winnerName} 승리!`, winner: winnerName });
    
    delete rooms[roomName];
    io.emit('roomListUpdate', getRoomList());
    
    // 랭킹 갱신
    const ranking = await getRankingDB();
    io.emit('rankingUpdate', ranking);
}

function getRoomList() {
    return Object.keys(rooms).map(key => ({
        name: key, isLocked: !!rooms[key].password, count: rooms[key].players.length, isPlaying: rooms[key].isPlaying
    }));
}

// DB에서 랭킹 가져오기
async function getRankingDB() {
    try {
        const users = await User.find().sort({ wins: -1 }).limit(5);
        return users.map(u => ({ name: u.name, wins: u.wins }));
    } catch (e) {
        return [];
    }
}

function checkWin(board, x, y, color) {
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let [dx, dy] of directions) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
            if (board[y + dy * i]?.[x + dx * i] === color) count++; else break;
        }
        for (let i = 1; i < 5; i++) {
            if (board[y - dy * i]?.[x - dx * i] === color) count++; else break;
        }
        if (count >= 5) return true;
    }
    return false;
}

// 서버 실행 (이 부분이 파일의 끝입니다)
server.listen(PORT, () => console.log(`서버 실행: ${PORT}`));