const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// ---------------------------------------------------------
// 1. MongoDB 연결 및 스키마
// ---------------------------------------------------------
const MONGO_URI = "mongodb+srv://koojj321:abcd1234@cluster0.yh4yszy.mongodb.net/?appName=Cluster0";
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ DB 연결 성공!'))
    .catch(err => console.error('❌ DB 연결 실패:', err));

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    wins: { type: Number, default: 0 },
    loses: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    items: { type: [String], default: ['default'] },
    equipped: { type: String, default: 'default' }
});
const User = mongoose.model('User', userSchema);

// ---------------------------------------------------------
// 2. 서버 메모리 데이터 및 로직
// ---------------------------------------------------------
const BOARD_SIZE = 19;
let rooms = {}; 
let connectedUsers = {}; 
let socketActivity = {}; 

setInterval(checkInactiveUsers, 60000); 

function checkInactiveUsers() {
    const now = Date.now();
    for (const id in socketActivity) {
        if (now - socketActivity[id] > INACTIVITY_TIMEOUT_MS) {
            const socketToDisconnect = io.sockets.sockets.get(id);
            if (socketToDisconnect) {
                socketToDisconnect.emit('force_logout', '30분간 활동이 없어 자동 로그아웃되었습니다.');
                socketToDisconnect.disconnect(true);
            }
            delete socketActivity[id];
            delete connectedUsers[id];
        }
    }
}

io.on('connection', (socket) => {
    let myRoom = null;
    let myName = null;

    socket.on('activity_ping', () => { if (socketActivity[socket.id]) socketActivity[socket.id] = Date.now(); });

    // [로그인]
    socket.on('login', async ({ name, password }) => {
        try {
            let user = await User.findOne({ name: name });
            if (user) {
                if (user.password !== password) return socket.emit('loginFail', '비밀번호 불일치');
            } else {
                user = new User({ name, password });
                await user.save();
            }

            myName = name; socket.myName = name; connected
