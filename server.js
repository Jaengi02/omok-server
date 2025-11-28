const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// 19줄 바둑판 설정
const BOARD_SIZE = 19;

// 유저 데이터 (users.json)
const DB_FILE = 'users.json';
let usersDB = {};
if (fs.existsSync(DB_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { usersDB = {}; }
} else { fs.writeFileSync(DB_FILE, '{}'); }

function saveDB() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(usersDB, null, 2)); } catch (e) { console.error(e); }
}

let rooms = {}; 
let connectedUsers = {}; 

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

    // [1] 로그인
    socket.on('login', ({ name, password }) => {
        if (usersDB[name] && usersDB[name].password !== password) {
            return socket.emit('loginFail', '비밀번호 불일치');
        }
        if (!usersDB[name]) { usersDB[name] = { password, wins: 0, loses: 0 }; saveDB(); }

        myName = name;
        socket.myName = name;
        connectedUsers[socket.id] = name;

        socket.emit('loginSuccess', { name, stats: usersDB[name] });
        socket.emit('roomListUpdate', getRoomList());
        socket.emit('rankingUpdate', getRanking());
        io.emit('userListUpdate', Object.values(connectedUsers));
    });

    // [2] 대기실 채팅
    socket.on('lobbyChat', (msg) => io.emit('lobbyChat', { sender: myName, msg }));

    // [3] 방 만들기
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방입니다.');

        rooms[roomName] = {
            password,
            players: [],      // 실제 플레이어 (최대 2명)
            spectators: [],   // 관전자 목록
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

    // [4] 방 입장 (플레이어 or 관전자)
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

        // 플레이어 자리가 있고, 게임 중이 아니면 -> 플레이어로 참가
        if (room.players.length < 2 && !room.isPlaying) {
            const color = room.players.length === 0 ? 'black' : 'white';
            const isHost = room.players.length === 0;
            const playerObj = { id: socket.id, name: socket.myName, color, isHost, isSpectator: false };
            room.players.push(playerObj);

            socket.emit('roomJoined', { 
                roomName, color, isHost, isSpectator: false, 
                players: room.players, board: room.board 
            });

            // 플레이어 2명이면 준비 알림
            if (room.players.length === 2) io.to(roomName).emit('status', '참여자가 준비하면 시작할 수 있습니다.');
            else socket.emit('status', '상대방을 기다리는 중...');

        } else {
            // 자리가 없거나 게임 중이면 -> 관전자로 참가
            const spectatorObj = { id: socket.id, name: socket.myName, isSpectator: true };
            room.spectators.push(spectatorObj);

            socket.emit('roomJoined', { 
                roomName, color: null, isHost: false, isSpectator: true, 
                players: room.players, board: room.board 
            });
            socket.emit('status', '관전 모드입니다.');
        }

        // 방 전체 정보 업데이트 (플레이어 + 관전자)
        io.to(roomName).emit('updateRoomInfo', { 
            players: room.players, 
            spectators: room.spectators,
            p2Ready: room.p2Ready 
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
        // 보드 초기화
        room.board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
        room.turn = 'black';

        io.to(myRoom).emit('gameStart', `게임 시작! ${room.players[0].name}(흑) 차례`);
        io.emit('roomListUpdate', getRoomList()); // 방 상태 '게임중'으로 변경 알림
        startTimer(myRoom);
    });

    // [7] 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        if (!room.isPlaying) return;

        // 관전자는 둘 수 없음
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

    // [8] 채팅
    socket.on('chat', (msg) => {
        if (myRoom && rooms[myRoom]) io.to(myRoom).emit('chat', { sender: myName, msg });
    });

    // [9] 나가기
    socket.on('leaveRoom', () => handleDisconnect());
    socket.on('disconnect', () => handleDisconnect());

    function handleDisconnect() {
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
                return; // 방은 유지됨
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

    if (winner && usersDB[winner.name]) usersDB[winner.name].wins++;
    if (loser && usersDB[loser.name]) usersDB[loser.name].loses++;
    saveDB();

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

// [CHANGED] 승리 체크 (19줄 대응)
function checkWin(board, x, y, color) {
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let [dx, dy] of directions) {
        let count = 1;
        // 19칸 밖으로 나가지 않도록 범위 체크 추가 가능하지만, JS 배열 특성상 undefined 처리로 넘김
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

server.listen(PORT, () => console.log(`서버 실행: ${PORT}`));