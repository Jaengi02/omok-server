const socket = io();

// UI 요소들
const board = document.getElementById('board');
const statusDiv = document.getElementById('status');
const roomListDiv = document.getElementById('room-list');
const rankingDiv = document.getElementById('ranking-list');
const timerSpan = document.getElementById('timer');
const chatMsgs = document.getElementById('chat-messages');

let myColor = null;
let myName = null;

// 🔊 효과음 로드 (파일이 없으면 소리 안 남)
const soundStone = new Audio('stone.mp3');
const soundWin = new Audio('win.mp3');
const soundLose = new Audio('lose.mp3');

// [1] 로그인
function login() {
    const name = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    if (!name || !pass) return alert('닉네임과 비밀번호를 입력하세요.');
    socket.emit('login', { name, password: pass });
}

socket.on('loginSuccess', ({ name, stats }) => {
    myName = name;
    document.getElementById('user-hello').innerText = `안녕하세요, ${name}님!`;
    const total = stats.wins + stats.loses;
    const rate = total === 0 ? 0 : Math.round((stats.wins / total) * 100);
    document.getElementById('user-stats').innerText = `전적: ${stats.wins}승 ${stats.loses}패 (${rate}%)`;

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
});
socket.on('loginFail', (msg) => alert(msg));

// [2] 랭킹 업데이트
socket.on('rankingUpdate', (rankList) => {
    rankingDiv.innerHTML = '';
    rankList.forEach((user, index) => {
        const p = document.createElement('p');
        p.innerText = `${index + 1}위: ${user.name} (${user.wins}승)`;
        if (index === 0) p.style.color = 'gold'; // 1등은 금색
        rankingDiv.appendChild(p);
    });
});

// [3] 방 기능 (만들기/입장/목록)
function createRoom() {
    const name = document.getElementById('create-room-name').value;
    const pass = document.getElementById('create-room-pass').value;
    if (!name) return alert('방 제목을 입력하세요.');
    socket.emit('createRoom', { roomName: name, password: pass });
}

socket.on('roomListUpdate', (rooms) => {
    roomListDiv.innerHTML = '';
    if (rooms.length === 0) { roomListDiv.innerHTML = '<p>방이 없습니다.</p>'; return; }
    rooms.forEach((room) => {
        const div = document.createElement('div');
        div.className = 'room-item';
        const lock = room.isLocked ? '🔒' : '';
        div.innerHTML = `<span>${room.name} ${lock} (${room.count}/2)</span>`;
        div.onclick = () => {
            if (room.count >= 2) return alert('꽉 찼습니다.');
            let pass = room.isLocked ? prompt('비밀번호:') : '';
            if (room.isLocked && pass === null) return;
            socket.emit('joinRoom', { roomName: room.name, password: pass });
        };
        roomListDiv.appendChild(div);
    });
});

// [4] 게임 시작 및 진행
socket.on('gameJoined', (data) => {
    myColor = data.color;
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('room-title').innerText = `방: ${data.roomName}`;
    chatMsgs.innerHTML = ''; // 채팅 초기화
    board.innerHTML = '';
    initBoard();
});

function initBoard() {
    for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 15; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.onclick = () => { if(myColor) socket.emit('placeStone', { x, y }); };
            board.appendChild(cell);
        }
    }
}

socket.on('updatePlayers', (players) => {
    const p1 = players.find(p => p.color === 'black');
    const p2 = players.find(p => p.color === 'white');
    document.getElementById('player-list').innerText = 
        `⚫${p1 ? p1.name : '...'} vs ⚪${p2 ? p2.name : '...'}`;
});

socket.on('updateBoard', (data) => {
    const cell = board.children[data.y * 15 + data.x];
    const stone = document.createElement('div');
    stone.className = `stone ${data.color}`;
    cell.appendChild(stone);
    
    // 🔊 소리 재생 (에러 방지용 try-catch)
    try { soundStone.play(); } catch(e) {}
});

// [5] 타이머 및 상태 업데이트
socket.on('status', (msg) => statusDiv.innerText = msg);
socket.on('timerUpdate', (time) => {
    timerSpan.innerText = time;
    timerSpan.style.color = time <= 5 ? 'red' : 'black'; // 5초 이하면 빨간색
});

// [6] 게임 종료
socket.on('gameOver', (data) => {
    // 🔊 승패 소리 재생
    if (data.winner === myName) {
        try { soundWin.play(); } catch(e) {}
        alert(`🎉 승리! ${data.msg}`);
    } else {
        try { soundLose.play(); } catch(e) {}
        alert(`😭 패배... ${data.msg}`);
    }
    location.reload();
});

socket.on('error', (msg) => alert(msg));
function leaveRoom() { socket.emit('leaveRoom'); location.reload(); }

// [7] 💬 채팅 기능
function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value;
    if (msg.trim()) {
        socket.emit('chat', msg);
        input.value = '';
    }
}

socket.on('chat', (data) => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<b>${data.sender}:</b> ${data.msg}`;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight; // 스크롤 맨 아래로
});