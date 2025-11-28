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
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(usersDB, null, 2));
    } catch (e) {
        console.error("저장 오류:", e);
    }
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

        // 로그인 성공 시 정보 전송
        socket.emit('loginSuccess', { name, stats: usersDB[name] });
        socket.emit('roomListUpdate', getRoomList());
        socket.emit('rankingUpdate', getRanking());
    });

    // [2] 대기실 채팅 (만남의 광장)
    socket.on('lobbyChat', (msg) => {
        // 대기실에 있는 모든 사람에게 전송
        io.emit('lobbyChat', { sender: myName, msg: msg });
    });

    // [3] 방 만들기
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방입니다.');

        rooms[roomName] = {
            password,
            players: [],
            board: Array(15).fill().map(() => Array(15).fill(null)),
            turn: 'black',
            timerId: null,
            timeLeft: 30,
            isPlaying: false, // 게임 진행 중 여부
            p2Ready: false    // 참여자 준비 여부
        };

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    // [4] 방 입장
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName];
        if (!room) return socket.emit('error', '존재하지 않는 방입니다.');
        if (room.players.length >= 2) return socket.emit('error', '방이 꽉 찼습니다.');
        if (room.isPlaying) return socket.emit('error', '이미 게임이 진행 중입니다.');
        if (room.password && room.password !== password) return socket.emit('error', '비밀번호 오류.');

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList());
    });

    function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName];
        myRoom = roomName;
        socket.join(roomName);

        // 첫 번째 사람(방장) = 흑돌, 두 번째 사람(참여자) = 백돌
        const color = room.players.length === 0 ? 'black' : 'white';
        const isHost = room.players.length === 0; 
        
        room.players.push({ id: socket.id, name: socket.myName, color, isHost });

        // 내 정보 전송
        socket.emit('roomJoined', { 
            roomName, color, isHost, players: room.players 
        });

        // 방 전체 인원 업데이트
        io.to(roomName).emit('updatePlayers', { 
            players: room.players, 
            p2Ready: room.p2Ready 
        });

        // 상태 메시지
        if (room.players.length === 2) {
            io.to(roomName).emit('status', '참여자가 준비하면 게임을 시작할 수 있습니다.');
        } else {
            socket.emit('status', '상대방을 기다리는 중...');
        }
    }

    // [5] 준비 완료 (참여자용)
    socket.on('toggleReady', () => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        
        const me = room.players.find(p => p.id === socket.id);
        if (!me || me.isHost) return; // 방장은 준비 버튼 동작 안 함

        room.p2Ready = !room.p2Ready;
        
        io.to(myRoom).emit('updatePlayers', { 
            players: room.players, 
            p2Ready: room.p2Ready 
        });
        
        const msg = room.p2Ready ? '참여자가 준비 완료! 방장님 시작하세요.' : '참여자가 준비를 취소했습니다.';
        io.to(myRoom).emit('status', msg);
    });

    // [6] 게임 시작 (방장용)
    socket.on('startGame', () => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        
        const me = room.players.find(p => p.id === socket.id);
        if (!me || !me.isHost) return;

        if (room.players.length < 2) return socket.emit('error', '사람이 부족합니다.');
        if (!room.p2Ready) return socket.emit('error', '참여자가 아직 준비하지 않았습니다.');

        room.isPlaying = true;
        io.to(myRoom).emit('gameStart', `게임 시작! ${room.players[0].name}(흑)님의 차례`);
        startTimer(myRoom);
    });

    // [7] 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];

        if (!room.isPlaying) return; // 게임 중일 때만

        const me = room.players.find(p => p.id === socket.id);
        if (!me || me.color !== room.turn || room.board[y][x] !== null) return;

        room.board[y][x] = me.color;
        room.turn = room.turn === 'black' ? 'white' : 'black';

        io.to(myRoom).emit('updateBoard', { x, y, color: me.color });

        if (checkWin(room.board, x, y, me.color)) {
            endGame(myRoom, me.name);
        } else {
            resetTimer(myRoom);
            const nextName = room.players.find(p => p.color === room.turn).name;
            io.to(myRoom).emit('status', `${nextName}(${room.turn === 'black'?'흑':'백'})님의 차례`);
        }
    });

    // [8] 게임방 채팅
    socket.on('chat', (msg) => {
        if (myRoom && rooms[myRoom]) {
            io.to(myRoom).emit('chat', { sender: myName, msg: msg });
        }
    });

    // [9] 나가기
    socket.on('leaveRoom', () => handleDisconnect());
    socket.on('disconnect', () => handleDisconnect());

    function handleDisconnect() {
        if (myRoom && rooms[myRoom]) {
            stopTimer(myRoom);
            const room = rooms[myRoom];
            
            if (room.isPlaying) {
                // 게임 중 나가면 패배 처리
                io.to(myRoom).emit('gameOver', { msg: `${myName}님이 나갔습니다. 상대방 승리!`, winner: 'opponent' });
            } else {
                // 대기 중 나가면 방 폭파
                io.to(myRoom).emit('error', '상대방이 나갔습니다. 로비로 이동합니다.');
                io.to(myRoom).emit('forceLeave');
            }
            
            delete rooms[myRoom];
            io.emit('roomListUpdate', getRoomList());
        }
    }
});

// 타이머
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

function endGame(roomName, winnerName) {
    const room = rooms[roomName];
    if (!room) return;
    stopTimer(roomName);

    const winner = room.players.find(p => p.name === winnerName);
    const loser = room.players.find(p => p.name !== winnerName);

    // 전적 업데이트 및 저장
    if (winner && usersDB[winner.name]) usersDB[winner.name].wins++;
    if (loser && usersDB[loser.name]) usersDB[loser.name].loses++;
    saveDB();

    // ★ 중요: 전적 업데이트 신호를 클라이언트에게 보냄
    if(winner) io.to(winner.id).emit('statsUpdate', usersDB[winner.name]);
    if(loser) io.to(loser.id).emit('statsUpdate', usersDB[loser.name]);

    io.to(roomName).emit('gameOver', { msg: `${winnerName} 승리!`, winner: winnerName });
    
    delete rooms[roomName];
    io.emit('roomListUpdate', getRoomList());
    io.emit('rankingUpdate', getRanking());
}

function getRoomList() {
    return Object.keys(rooms).map(key => ({
        name: key, isLocked: !!rooms[key].password, count: rooms[key].players.length, isPlaying: rooms[key].isPlaying
    }));
}
function getRanking() {
    return Object.keys(usersDB).map(name => ({ name, ...usersDB[name] }))
        .sort((a, b) => b.wins - a.wins).slice(0, 5);
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

server.listen(PORT, () => console.log(`서버 실행: 포트 ${PORT}`));