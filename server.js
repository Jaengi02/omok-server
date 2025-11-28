const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// ---------------------------------------------------------
// 1. 유저 데이터 (users.json)
// ---------------------------------------------------------
const DB_FILE = 'users.json';
let usersDB = {};

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
    fs.writeFileSync(DB_FILE, JSON.stringify(usersDB, null, 2));
}

// ---------------------------------------------------------
// 2. 서버 메모리 데이터
// ---------------------------------------------------------
let rooms = {}; 

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

    // [1] 로그인
    socket.on('login', ({ name, password }) => {
        if (usersDB[name]) {
            if (usersDB[name].password !== password) {
                return socket.emit('loginFail', '비밀번호가 틀렸습니다!');
            }
        } else {
            usersDB[name] = { password, wins: 0, loses: 0 };
            saveDB();
        }

        myName = name;
        socket.myName = name;

        socket.emit('loginSuccess', { name, stats: usersDB[name] });
        socket.emit('roomListUpdate', getRoomList());
        socket.emit('rankingUpdate', getRanking()); // 랭킹 전송
    });

    // [2] 방 만들기
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방 이름입니다.');

        rooms[roomName] = {
            password,
            players: [],
            board: Array(15).fill().map(() => Array(15).fill(null)),
            turn: 'black',
            timerId: null, // 타이머 ID
            timeLeft: 30   // 남은 시간 (초)
        };

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    // [3] 방 입장
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName];
        if (!room) return socket.emit('error', '존재하지 않는 방입니다.');
        if (room.players.length >= 2) return socket.emit('error', '방이 꽉 찼습니다.');
        if (room.password && room.password !== password) return socket.emit('error', '비밀번호 오류.');

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName];
        myRoom = roomName;
        socket.join(roomName);

        const color = room.players.length === 0 ? 'black' : 'white';
        room.players.push({ id: socket.id, name: socket.myName, color });

        socket.emit('gameJoined', { roomName, color, players: room.players });
        io.to(roomName).emit('updatePlayers', room.players);

        // 2명 다 모이면 게임 시작
        if (room.players.length === 2) {
            io.to(roomName).emit('status', `게임 시작! ${room.players[0].name}(흑)님의 차례`);
            startTimer(roomName); // 타이머 시작
        } else {
            socket.emit('status', '상대방을 기다리는 중...');
        }
    }

    // [4] 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        const me = room.players.find(p => p.id === socket.id);

        // 내 턴, 빈 칸, 2명인지 확인
        if (!me || me.color !== room.turn || room.board[y][x] !== null || room.players.length < 2) return;

        // 돌 두기
        room.board[y][x] = me.color;
        room.turn = room.turn === 'black' ? 'white' : 'black';

        io.to(myRoom).emit('updateBoard', { x, y, color: me.color }); // 돌 정보 + 소리 재생 신호

        // 승리 체크
        if (checkWin(room.board, x, y, me.color)) {
            endGame(myRoom, me.name); // 승자 이름으로 게임 종료
        } else {
            // 게임 계속 -> 타이머 리셋 및 턴 변경 알림
            resetTimer(myRoom);
            const nextName = room.players.find(p => p.color === room.turn).name;
            io.to(myRoom).emit('status', `${nextName}(${room.turn === 'black'?'흑':'백'})님의 차례`);
        }
    });

    // [5] 채팅 메시지 처리
    socket.on('chat', (msg) => {
        if (myRoom && rooms[myRoom]) {
            // 방에 있는 사람들에게만 메시지 전송
            io.to(myRoom).emit('chat', { sender: myName, msg: msg });
        }
    });

    // [6] 접속 종료 / 나가기
    socket.on('leaveRoom', () => handleDisconnect());
    socket.on('disconnect', () => handleDisconnect());

    function handleDisconnect() {
        if (myRoom && rooms[myRoom]) {
            stopTimer(myRoom); // 타이머 멈춤
            io.to(myRoom).emit('gameOver', { msg: `${myName}님이 나갔습니다. 상대방 승리!`, winner: 'opponent' });
            delete rooms[myRoom];
            io.emit('roomListUpdate', getRoomList());
        }
    }
});

// --- 타이머 기능 ---
function startTimer(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    
    room.timeLeft = 30; // 30초 설정
    io.to(roomName).emit('timerUpdate', room.timeLeft);

    room.timerId = setInterval(() => {
        room.timeLeft--;
        io.to(roomName).emit('timerUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            // 시간 초