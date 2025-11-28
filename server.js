// 파일명: server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let board = Array(15).fill().map(() => Array(15).fill(null));
let players = []; // { id, color, name } 형태로 저장
let currentTurn = 'black';

function checkWin(x, y, color) {
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

io.on('connection', (socket) => {
    // 플레이어가 'join' 이벤트를 보낼 때까지 기다림 (이름을 받기 위해)
    socket.on('join', (playerName) => {
        if (players.length < 2) {
            const color = players.length === 0 ? 'black' : 'white';
            // 이름(name)도 같이 저장!
            players.push({ id: socket.id, color, name: playerName });
            
            socket.emit('init', { color, board });

            if (players.length === 2) {
                const blackPlayer = players.find(p => p.color === 'black');
                io.emit('ready', `게임 시작! ${blackPlayer.name}(흑돌)님의 차례입니다.`);
            }
        } else {
            socket.emit('full', '방이 꽉 찼습니다.');
        }
    });

    socket.on('placeStone', ({ x, y }) => {
        const player = players.find(p => p.id === socket.id);
        if (!player || player.color !== currentTurn || board[y][x] !== null || players.length < 2) return;

        board[y][x] = player.color;
        io.emit('updateBoard', { x, y, color: player.color });

        if (checkWin(x, y, player.color)) {
            io.emit('gameOver', `${player.name} 승리!`);
            setTimeout(() => {
                board = Array(15).fill().map(() => Array(15).fill(null));
                currentTurn = 'black';
                io.emit('reset', '새 게임 시작!');
            }, 3000);
        } else {
            currentTurn = currentTurn === 'black' ? 'white' : 'black';
            const nextPlayer = players.find(p => p.color === currentTurn);
            // 다음 차례 사람의 이름을 보내줌
            io.emit('turnChange', { 
                currentTurn, 
                message: `${nextPlayer.name}(${currentTurn === 'black'?'흑':'백'})님의 차례` 
            });
        }
    });

    socket.on('disconnect', () => {
        const leftPlayer = players.find(p => p.id === socket.id);
        players = players.filter(p => p.id !== socket.id);
        if(leftPlayer) {
            board = Array(15).fill().map(() => Array(15).fill(null));
            currentTurn = 'black';
            io.emit('reset', `${leftPlayer.name}님이 나갔습니다. 게임 종료.`);
        }
    });
});

// process.env.PORT가 있으면 그걸 쓰고, 없으면 3000번을 쓴다는 뜻입니다.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});