// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// 전체 게임 상태 관리
// rooms = { 'roomID': { board: [], turn: 'black', players: [socketId1, socketId2] } }
let rooms = {}; 
let waitingPlayer = null; // 대기 중인 사람 (한 명만 저장)

io.on('connection', (socket) => {
    console.log('새로운 접속:', socket.id);
    let myRoomId = null;
    let myName = null;

    // 1. 로비 입장 (닉네임 저장)
    socket.on('joinLobby', (name) => {
        myName = name;
        io.emit('userCount', io.engine.clientsCount); // 전체 접속자 수 알림
    });

    // 2. 게임 매칭 요청
    socket.on('requestGame', () => {
        if (waitingPlayer) {
            // 대기자가 있으면 -> 매칭 성공!
            const opponent = waitingPlayer;
            waitingPlayer = null; // 대기열 비움

            // 방 ID 생성 (두 사람의 ID를 합침)
            const roomId = socket.id + '#' + opponent.id;
            
            // 두 사람을 방에 넣음
            opponent.join(roomId);
            socket.join(roomId);

            // 방 데이터 생성 (각 방마다 따로 바둑판을 가짐)
            rooms[roomId] = {
                board: Array(15).fill().map(() => Array(15).fill(null)),
                turn: 'black',
                players: [opponent.id, socket.id], // [흑돌, 백돌]
                names: [opponent.myName, myName]
            };

            // 게임 시작 알림 (흑돌, 백돌 지정)
            io.to(opponent.id).emit('gameStart', { color: 'black', roomId: roomId, opponentName: myName });
            io.to(socket.id).emit('gameStart', { color: 'white', roomId: roomId, opponentName: opponent.myName });
            
            // 상대방에게 방 ID 저장 (나중에 쓰기 위함)
            opponent.myRoomId = roomId;
            socket.myRoomId = roomId; // socket 객체에 직접 저장

        } else {
            // 대기자가 없으면 -> 내가 대기자가 됨
            waitingPlayer = socket;
            socket.myName = myName; // 소켓에 이름 저장해둠
            socket.emit('waiting');
        }
    });

    // 3. 돌 두기
    socket.on('placeStone', ({ x, y }) => {
        // 내 방 찾기
        const roomId = socket.myRoomId;
        const room = rooms[roomId];

        if (!room) return; // 방이 없으면 무시

        const myColor = room.players[0] === socket.id ? 'black' : 'white';
        
        // 내 턴인지, 빈 칸인지 확인
        if (room.turn !== myColor || room.board[y][x] !== null) return;

        // 돌 두기 & 턴 넘기기
        room.board[y][x] = myColor;
        room.turn = room.turn === 'black' ? 'white' : 'black';

        // 방에 있는 사람들에게만 알림! (io.to(roomId))
        io.to(roomId).emit('updateBoard', { x, y, color: myColor });
        
        // 승리 체크
        if (checkWin(room.board, x, y, myColor)) {
            io.to(roomId).emit('gameOver', `${myColor === 'black' ? '흑돌' : '백돌'} 승리!`);
            delete rooms[roomId]; // 게임 끝났으니 방 삭제
        } else {
            io.to(roomId).emit('turnChange', { turn: room.turn });
        }
    });

    // 4. 접속 종료 처리
    socket.on('disconnect', () => {
        if (waitingPlayer === socket) {
            waitingPlayer = null; // 대기 중 나감
        }
        // 게임 중 나감
        if (socket.myRoomId && rooms[socket.myRoomId]) {
            io.to(socket.myRoomId).emit('gameOver', '상대방이 나갔습니다. 승리!');
            delete rooms[socket.myRoomId];
        }
        io.emit('userCount', io.engine.clientsCount);
    });
});

// 승리 로직 (board를 인자로 받아야 함)
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

server.listen(PORT, () => console.log(`서버 실행 중: ${PORT}`));