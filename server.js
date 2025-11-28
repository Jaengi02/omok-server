const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Render 배포를 위해 포트 설정 (중요!)
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
    // 에러 방지를 위한 동기 저장
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
        const room = rooms[roomName