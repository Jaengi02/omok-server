// public/client.js
const socket = io();
const board = document.getElementById('board');
const statusDiv = document.getElementById('status');
const roomListDiv = document.getElementById('room-list');
let myColor = null;

// [1] 로그인 요청
function login() {
    const name = document.getElementById('username').value;
    if (!name) return alert('닉네임을 입력하세요.');
    socket.emit('login', name);
}

// [2] 로그인 성공 (전적 받음)
socket.on('loginSuccess', ({ name, stats }) => {
    document.getElementById('user-hello').innerText = `안녕하세요, ${name}님!`;
    
    // 승률 계산
    const total = stats.wins + stats.loses;
    const rate = total === 0 ? 0 : Math.round((stats.wins / total) * 100);
    document.getElementById('user-stats').innerText = `[전적: ${stats.wins}승 ${stats.loses}패 (승률 ${rate}%)]`;

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
});

socket.on('loginFail', (msg) => alert(msg));

// [3] 방 만들기
function createRoom() {
    const name = document.getElementById('create-room-name').value;
    const pass = document.getElementById('create-room-pass').value;
    if (!name) return alert('방 제목을 입력하세요.');
    socket.emit('createRoom', { roomName: name, password: pass });
}

// [4] 방 목록 업데이트 (서버가 보내줌)
socket.on('roomListUpdate', (rooms) => {
    roomListDiv.innerHTML = ''; // 기존 목록 지우기

    if (rooms.length === 0) {
        roomListDiv.innerHTML = '<p>현재 개설된 방이 없습니다.</p>';
        return;
    }

    rooms.forEach((room) => {
        const div = document.createElement('div');
        div.className = 'room-item';
        // 방 제목 + 잠금표시 + 인원수
        const lockIcon = room.isLocked ? '🔒' : '🔓';
        div.innerHTML = `<span>${room.name} ${lockIcon} (${room.count}/2)</span>`;
        
        // 클릭하면 입장 시도
        div.onclick = () => {
            if (room.count >= 2) return alert('꽉 찬 방입니다.');
            
            let password = '';
            if (room.isLocked) {
                password = prompt('비밀번호를 입력하세요:');
                if (password === null) return; // 취소 누름
            }
            socket.emit('joinRoom', { roomName: room.name, password: password });
        };
        roomListDiv.appendChild(div);
    });
});

// [5] 게임 입장 및 진행 (기존과 유사)
socket.on('gameJoined', (data) => {
    myColor = data.color;
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('room-title').innerText = `방: ${data.roomName}`;
    board.innerHTML = '';
    initBoard();
});

socket.on('updatePlayers', (players) => {
    const p1 = players.find(p => p.color === 'black');
    const p2 = players.find(p => p.color === 'white');
    const p1Name = p1 ? p1.name : "대기중";
    const p2Name = p2 ? p2.name : "대기중";
    document.getElementById('player-list').innerText = `⚫${p1Name} vs ⚪${p2Name}`;
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
socket.on('updateBoard', (data) => {
    const cell = board.children[data.y * 15 + data.x];
    const stone = document.createElement('div');
    stone.className = `stone ${data.color}`;
    cell.appendChild(stone);
});
socket.on('status', (msg) => statusDiv.innerText = msg);
socket.on('gameOver', (msg) => { alert(msg); location.reload(); });
socket.on('error', (msg) => alert(msg));
function leaveRoom() { socket.emit('leaveRoom'); location.reload(); }