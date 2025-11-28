// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// 방 목록 (Key: 방제목, Value: 방 정보)
let rooms = {}; 

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

    // 1. 로비 입장
    socket.on('login', (name) => {
        myName = name;
        socket.myName = name;
    });

    // 2. 방 만들기
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) {
            socket.emit('error', '이미 존재하는 방 이름입니다.');
            return;
        }

        // 방 생성
        rooms[roomName] = {
            password: password, // 비밀번호 저장
            players: [], // 참여자 목록 {id, name, color}
            board: Array(15).fill().map(() => Array(15).fill(null)),
            turn: 'black'
        };

        joinRoomProcess(socket, roomName);
    });

    // 3. 방 입장하기
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName];

        if (!room) {
            socket.emit('error', '존재하지 않는 방입니다.');
            return;
        }
        if (room.players.length >= 2) {
            socket.emit('error', '방이 꽉 찼습니다.');
            return;
        }
        if (room.password && room.password !== password) {
            socket.emit('error', '비밀번호가 틀렸습니다.');
            return;
        }

        joinRoomProcess(socket, roomName);
    });

    // [공통] 방 입장 처리 함수
    function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName];
        myRoom = roomName;
        socket.join(roomName);

        // 색깔 결정 (첫 번째면 흑, 두 번째면 백)
        const color = room.players.length === 0 ? 'black' : 'white';
        room.players.push({ id: socket.id, name: socket.myName, color: color });

        // 클라이언트에게 게임 시작 알림 (방 정보, 내 색깔)
        socket.emit('gameJoined', { 
            roomName: roomName, 
            color: color, 
            players: room.players 
        });

        // 방에 있는 모든 사람에게 "참여자 목록" 업데이트
        io.to(roomName).emit('updatePlayers', room.players);

        // 2명이 모이면 알림
        if (room.players.length === 2) {
            io.to(roomName).emit('status', `게임 시작! ${room.players[0].name}(흑돌)님의 차례`);
        } else {
            socket.emit('status', '상대방을 기다리는 중...');
        }
    }

    // 4. 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        
        // 내 턴인지 확인
        const me = room.players.find(p => p.id === socket.id);
        if (!me || me.color !== room.turn || room.board[y][x] !== null || room.players.length < 2) return;

        room.board[y][x] = me.color;
        room.turn = room.turn === 'black' ? 'white' : 'black';

        // 돌 업데이트 & 턴 알림
        io.to(myRoom).emit('updateBoard', { x, y, color: me.color });
        
        const nextPlayer = room.players.find(p => p.color === room.turn);
        io.to(myRoom).emit('status', `${nextPlayer.name}(${room.turn === 'black'?'흑':'백'})님의 차례`);

        if (checkWin(room.board, x, y, me.color)) {
            io.to(myRoom).emit('gameOver', `${me.name} 승리!`);
            delete rooms[myRoom]; // 게임 끝 방 삭제
        }
    });

    // 5. 나가기
    socket.on('disconnect', () => handleDisconnect());
    socket.on('leaveRoom', () => handleDisconnect());

    function handleDisconnect() {
        if (myRoom && rooms[myRoom]) {
            io.to(myRoom).emit('gameOver', `${myName}님이 나갔습니다. 게임 종료.`);
            io.to(myRoom).emit('leaveRoomSuccess'); // 클라이언트 화면 전환용
            delete rooms[myRoom];
        }
    }
});

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

server.listen(PORT, () => console.log(`서버 실행: ${PORT}`));