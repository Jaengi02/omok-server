const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Render 배포를 위한 포트 설정
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// ---------------------------------------------------------
// 1. 유저 데이터 (users.json)
// 주의: Render 무료 서버는 재부팅되면 이 파일이 초기화됩니다.
// (수익화를 위해서는 나중에 데이터베이스로 교체해야 합니다)
// ---------------------------------------------------------
const DB_FILE = 'users.json';
let usersDB = {};

// 서버 시작 시 파일 읽기
if (fs.existsSync(DB_FILE)) {
    try {
        usersDB = JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) {
        usersDB = {};
    }
} else {
    fs.writeFileSync(DB_FILE, '{}');
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(usersDB, null, 2));
    } catch (e) {
        console.error("데이터 저장 실패:", e);
    }
}

// ---------------------------------------------------------
// 2. 서버 메모리 데이터
// ---------------------------------------------------------
let rooms = {}; 

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

    // [1] 로그인 처리
    socket.on('login', ({ name, password }) => {
        if (usersDB[name]) {
            // 기존 유저: 비밀번호 체크
            if (usersDB[name].password !== password) {
                return socket.emit('loginFail', '비밀번호가 틀렸습니다!');
            }
        } else {
            // 신규 유저: 가입
            usersDB[name] = { password, wins: 0, loses: 0 };
            saveDB();
        }

        myName = name;
        socket.myName = name;

        // 로그인 성공 전송
        socket.emit('loginSuccess', { name, stats: usersDB[name] });
        // 방 목록과 랭킹 전송
        socket.emit('roomListUpdate', getRoomList());
        socket.emit('rankingUpdate', getRanking());
    });

    // [2] 방 만들기
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) {
            return socket.emit('error', '이미 존재하는 방 이름입니다.');
        }

        rooms[roomName] = {
            password,
            players: [],
            board: Array(15).fill().map(() => Array(15).fill(null)),
            turn: 'black',
            timerId: null,
            timeLeft: 30
        };

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    // [3] 방 입장하기
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName]; // <--- 아까 여기서 끊겼던 겁니다.

        if (!room) return socket.emit('error', '존재하지 않는 방입니다.');
        if (room.players.length >= 2) return socket.emit('error', '방이 꽉 찼습니다.');
        if (room.password && room.password !== password) {
            return socket.emit('error', '비밀번호가 틀렸습니다.');
        }

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    // 방 입장 공통 로직
    function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName];
        myRoom = roomName;
        socket.join(roomName);

        const color = room.players.length === 0 ? 'black' : 'white';
        room.players.push({ id: socket.id, name: socket.myName, color });

        socket.emit('gameJoined', { roomName, color, players: room.players });
        io.to(roomName).emit('updatePlayers', room.players);

        // 2명이 모이면 게임 시작
        if (room.players.length === 2) {
            io.to(roomName).emit('status', `게임 시작! ${room.players[0].name}(흑)님의 차례`);
            startTimer(roomName);
        } else {
            socket.emit('status', '상대방을 기다리는 중...');
        }
    }

    // [4] 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        const me = room.players.find(p => p.id === socket.id);

        if (!me || me.color !== room.turn || room.board[y][x] !== null || room.players.length < 2) return;

        // 돌 두기 처리
        room.board[y][x] = me.color;
        room.turn = room.turn === 'black' ? 'white' : 'black';

        io.to(myRoom).emit('updateBoard', { x, y, color: me.color });

        // 승리 체크
        if (checkWin(room.board, x, y, me.color)) {
            endGame(myRoom, me.name);
        } else {
            resetTimer(myRoom);
            const nextName = room.players.find(p => p.color === room.turn).name;
            io.to(myRoom).emit('status', `${nextName}(${room.turn === 'black'?'흑':'백'})님의 차례`);
        }
    });

    // [5] 채팅
    socket.on('chat', (msg) => {
        if (myRoom && rooms[myRoom]) {
            io.to(myRoom).emit('chat', { sender: myName, msg: msg });
        }
    });

    // [6] 나가기 처리
    socket.on('leaveRoom', () => handleDisconnect());
    socket.on('disconnect', () => handleDisconnect());

    function handleDisconnect() {
        if (myRoom && rooms[myRoom]) {
            stopTimer(myRoom);
            // 기권패 처리
            io.to(myRoom).emit('gameOver', { msg: `${myName}님이 나갔습니다. 상대방 승리!`, winner: 'opponent' });
            delete rooms[myRoom];
            io.emit('roomListUpdate', getRoomList());
        }
    }
});

// --- 타이머 함수들 ---
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
            // 시간 초과 시 상대방 승리
            const loserColor = room.turn;
            const winner = room.players.find(p => p.color !== loserColor);
            if (winner) endGame(roomName, winner.name);
            else delete rooms[roomName];
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
    if (rooms[roomName] && rooms[roomName].timerId) {
        clearInterval(rooms[roomName].timerId);
    }
}

// --- 게임 종료 처리 ---
function endGame(roomName, winnerName) {
    const room = rooms[roomName];
    if (!room) return;
    stopTimer(roomName);

    const winner = room.players.find(p => p.name === winnerName);
    const loser = room.players.find(p => p.name !== winnerName);

    // 전적 업데이트
    if (winner && usersDB[winner.name]) usersDB[winner.name].wins++;
    if (loser && usersDB[loser.name]) usersDB[loser.name].loses++;
    saveDB();

    io.to(roomName).emit('gameOver', { msg: `${winnerName} 승리!`, winner: winnerName });
    
    delete rooms[roomName];
    io.emit('roomListUpdate', getRoomList());
    io.emit('rankingUpdate', getRanking());
}

// --- 헬퍼 함수 ---
function getRoomList() {
    return Object.keys(rooms).map(key => ({
        name: key,
        isLocked: !!rooms[key].password,
        count: rooms[key].players.length
    }));
}

function getRanking() {
    return Object.keys(usersDB)
        .map(name => ({ name, ...usersDB[name] }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 5);
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

// ▼▼▼ 이 부분이 꼭 있어야 합니다! ▼▼▼
server.listen(PORT, () => {
    console.log(`서버 실행 중: 포트 ${PORT}`);
});