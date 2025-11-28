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
            
            // 랭킹