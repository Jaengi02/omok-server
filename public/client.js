// public/client.js
const socket = io();
const board = document.getElementById('board');
const statusDiv = document.getElementById('status');
let myColor = null;

// [1] 로비 입장
function enterLobby() {
    const name = document.getElementById('username').value;
    if (!name) return alert('닉네임을 입력하세요.');
    socket.emit('login', name);
    
    document.getElementById('user-hello').innerText = `안녕하세요, ${name}님!`;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
}

// [2] 방 만들기
function createRoom() {
    const name = document.getElementById('create-room-name').value;
    const pass = document.getElementById('create-room-pass').value;
    if (!name) return alert('방 제목을 입력하세요.');
    socket.emit('createRoom', { roomName: name, password: pass });
}

// [3] 방 들어가기
function joinRoom() {
    const name = document.getElementById('join-room-name').value;
    const pass = document.getElementById('join-room-pass').value;
    if (!name) return alert('방 제목을 입력하세요.');
    socket.emit('joinRoom', { roomName: name, password: pass });
}

// [4] 방 나가기
function leaveRoom() {
    if(confirm("정말 나가시겠습니까?")) {
        socket.emit('leaveRoom');
        location.reload();
    }
}

// [5] 서버 응답 처리
socket.on('error', (msg) => alert(msg));

// 방 입장 성공! (게임 화면으로 전환)
socket.on('gameJoined', (data) => {
    myColor = data.color;
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    
    document.getElementById('room-title').innerText = `방: ${data.roomName}`;
    board.innerHTML = '';
    initBoard();
});

// 참여자 목록 업데이트 (화면에 이름 표시)
socket.on('updatePlayers', (players) => {
    const p1 = players.find(p => p.color === 'black');
    const p2 = players.find(p => p.color === 'white');
    
    document.getElementById('p1-name').innerText = p1 ? `${p1.name}(흑)` : "기다리는 중...";
    document.getElementById('p2-name').innerText = p2 ? `${p2.name}(백)` : "기다리는 중...";
});

// 기존 게임 로직들
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