// server.js (전체 덮어쓰기)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs'); // 파일을 다루는 도구

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// 1. 유저 데이터 관리 (users.json 파일 사용)
const DB_FILE = 'users.json';
let usersDB = {};

// 서버 켤 때 파일 읽어오기
if (fs.existsSync(DB_FILE)) {
    const data = fs.readFileSync(DB_FILE);
    usersDB = JSON.parse(data);
} else {
    fs.writeFileSync(DB_FILE, '{}'); // 파일 없으면 빈 파일 생성
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(usersDB, null, 2));
}

// 2. 서버 메모리 데이터
let rooms = {}; // 방 목록
let activeIPs = new Set(); // 접속 중인 IP 목록

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;
    
    // IP 주소 가져오기 (::1은 localhost)
    const clientIp = socket.handshake.address;

    // [1] 로그인 (IP 체크 + 전적 로드)
    socket.on('login', (name) => {
        // IP 중복 체크 (테스트할 때는 주석 처리하세요!)
        /*
        if (activeIPs.has(clientIp)) {
            socket.emit('loginFail', '하나의 IP에서는 하나의 아이디만 접속 가능합니다.');
            return;
        }
        */

        // DB에 유저 없으면 생성
        if (!usersDB[name]) {
            usersDB[name] = { wins: 0, loses: 0 };
            saveDB();
        }

        myName = name;
        socket.myName = name;
        activeIPs.add(clientIp); // IP 등록

        // 로그인 성공 알림 (전적 정보 포함)
        socket.emit('loginSuccess', { 
            name: name, 
            stats: usersDB[name] 
        });

        // 대기실에 있는 모두에게 현재 방 목록 전송
        io.emit('roomListUpdate', getRoomList());
    });

    // [2] 방 만들기
    socket.on('createRoom', ({ roomName, password }) => {
        if (rooms[roomName]) return socket.emit('error', '이미 존재하는 방입니다.');

        rooms[roomName] = {
            password: password,
            players: [],
            board: Array(15).fill().map(() => Array(15).fill(null)),
            turn: 'black'
        };

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList()); // 방 생겼으니 목록 갱신
    });

    // [3] 방 들어가기 (비밀번호 체크)
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = rooms[roomName];
        if (!room) return socket.emit('error', '존재하지 않는 방입니다.');
        if (room.players.length >= 2) return socket.emit('error', '방이 꽉 찼습니다.');
        
        // 비밀번호가 설정되어 있는데 틀렸을 경우
        if (room.password && room.password !== password) {
            return socket.emit('error', '비밀번호가 틀렸습니다.');
        }

        joinRoomProcess(socket, roomName);
        io.emit('roomListUpdate', getRoomList()); // 인원 변동 -> 목록 갱신
    });

    // 방 입장 공통 함수
    function joinRoomProcess(socket, roomName) {
        const room = rooms[roomName];
        myRoom = roomName;
        socket.join(roomName);

        const color = room.players.length === 0 ? 'black' : 'white';
        room.players.push({ id: socket.id, name: socket.myName, color: color });

        socket.emit('gameJoined', { roomName, color, players: room.players });
        io.to(roomName).emit('updatePlayers', room.players);

        if (room.players.length === 2) {
            io.to(roomName).emit('status', `게임 시작! ${room.players[0].name}(흑)님의 차례`);
        } else {
            socket.emit('status', '상대방을 기다리는 중...');
        }
    }

    // [4] 돌 두기 & 승패 기록
    socket.on('placeStone', ({ x, y }) => {
        if (!myRoom || !rooms[myRoom]) return;
        const room = rooms[myRoom];
        const me = room.players.find(p => p.id === socket.id);
        
        if (!me || me.color !== room.turn || room.board[y][x] !== null || room.players.length < 2) return;

        room.board[y][x] = me.color;
        room.turn = room.turn === 'black' ? 'white' : 'black';

        io.to(myRoom).emit('updateBoard', { x, y, color: me.color });
        
        // 승리 체크
        if (checkWin(room.board, x, y, me.color)) {
            const winner = me;
            const loser = room.players.find(p => p.id !== socket.id);

            // 전적 업데이트
            usersDB[winner.name].wins++;
            usersDB[loser.name].loses++;
            saveDB(); // 파일 저장

            io.to(myRoom).emit('gameOver', `${winner.name} 승리! (전적 저장됨)`);
            delete rooms[myRoom]; // 방 삭제
            io.emit('roomListUpdate', getRoomList()); // 방 사라졌으니 목록 갱신

        } else {
            const nextName = room.players.find(p => p.color === room.turn).name;
            io.to(myRoom).emit('status', `${nextName}(${room.turn === 'black'?'흑':'백'})님의 차례`);
        }
    });

    // [5] 나가기 처리
    socket.on('leaveRoom', () => handleDisconnect());
    socket.on('disconnect', () => {
        activeIPs.delete(clientIp); // IP 제한 해제
        handleDisconnect();
    });

    function handleDisconnect() {
        if (myRoom && rooms[myRoom]) {
            io.to(myRoom).emit('gameOver', `${myName}님이 나갔습니다. 기권패 처리됩니다.`);
            // 기권패 처리도 원하면 여기에 로직 추가 가능
            delete rooms[myRoom];
            io.emit('roomListUpdate', getRoomList());
        }
    }
});

// 방 목록을 예쁘게 정리해서 보내주는 함수
function getRoomList() {
    return Object.keys(rooms).map(key => {
        return {
            name: key,
            isLocked: !!rooms[key].password, // 비밀번호 있으면 true
            count: rooms[key].players.length // 현재 인원 (1/2)
        };
    });
}

// 승리 체크 로직 (기존 동일)
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