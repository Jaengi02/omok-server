const socket = io();

// UI 요소
const board = document.getElementById('board');
const statusDiv = document.getElementById('status');
const roomListDiv = document.getElementById('room-list');
const rankingDiv = document.getElementById('ranking-list');
const timerSpan = document.getElementById('timer');
const chatMsgs = document.getElementById('chat-messages');

// 게임 컨트롤 버튼
const btnReady = document.getElementById('btn-ready');
const btnStart = document.getElementById('btn-start');

let myColor = null;
let myName = null;
let amIHost = false; // 내가 방장인가?

const soundStone = new Audio('stone.mp3');
const soundWin = new Audio('win.mp3');
const soundLose = new Audio('lose.mp3');

// [0] 자동 로그인
window.onload = () => {
    const savedName = localStorage.getItem('omok-name');
    const savedPass = localStorage.getItem('omok-pass');
    if (savedName && savedPass) {
        socket.emit('login', { name: savedName, password: savedPass });
    }
};

// [1] 로그인 / 로그아웃
function login() {
    const name = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    if (!name || !pass) return alert('입력해주세요.');
    socket.emit('login', { name, password: pass });
}

function logout() {
    if(confirm('로그아웃 하시겠습니까?')) {
        localStorage.removeItem('omok-name');
        localStorage.removeItem('omok-pass');
        location.reload();
    }
}

socket.on('loginSuccess', ({ name, stats }) => {
    myName = name;
    localStorage.setItem('omok-name', document.getElementById('username').value || name);
    const passVal = document.getElementById('password').value;
    if(passVal) localStorage.setItem('omok-pass', passVal);

    updateUserStats(stats); // 전적 표시 함수 분리

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
});

socket.on('loginFail', (msg) => {
    localStorage.removeItem('omok-name');
    localStorage.removeItem('omok-pass');
    alert(msg);
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('lobby-screen').classList.add('hidden');
});

// 전적 업데이트 함수 (게임 끝나고도 호출됨)
function updateUserStats(stats) {
    const total = stats.wins + stats.loses;
    const rate = total === 0 ? 0 : Math.round((stats.wins / total) * 100);
    document.getElementById('user-stats').innerText = `내 전적: ${stats.wins}승 ${stats.loses}패 (승률 ${rate}%)`;
}

// 실시간 전적 업데이트 받기
socket.on('statsUpdate', (stats) => {
    updateUserStats(stats);
});

// [2] 대기실 채팅
function sendLobbyChat() {
    const input = document.getElementById('lobby-chat-input');
    if(input.value.trim()) {
        socket.emit('lobbyChat', input.value);
        input.value = '';
    }
}
socket.on('lobbyChat', (data) => {
    const box = document.getElementById('lobby-chat-box');
    const p = document.createElement('div');
    p.innerHTML = `<b>${data.sender}:</b> ${data.msg}`;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
});

// [3] 랭킹 & 방목록
socket.on('rankingUpdate', (rankList) => {
    rankingDiv.innerHTML = '';
    rankList.forEach((user, index) => {
        const p = document.createElement('p');
        p.innerText = `${index + 1}위: ${user.name} (${user.wins}승)`;
        if (index === 0) p.style.color = '#d4af37';
        rankingDiv.appendChild(p);
    });
});

function createRoom() {
    const name = document.getElementById('create-room-name').value;
    const pass = document.getElementById('create-room-pass').value;
    if (!name) return alert('방 제목 입력.');
    socket.emit('createRoom', { roomName: name, password: pass });
}

socket.on('roomListUpdate', (rooms) => {
    roomListDiv.innerHTML = '';
    if (rooms.length === 0) { roomListDiv.innerHTML = '<p>방이 없습니다.</p>'; return; }
    rooms.forEach((room) => {
        const div = document.createElement('div');
        div.className = 'room-item';
        const lock = room.isLocked ? '🔒' : '';
        const status = room.isPlaying ? '(게임중)' : `(${room.count}/2)`;
        div.innerHTML = `<span>${room.name} ${lock} ${status}</span>`;
        div.onclick = () => {
            if (room.count >= 2) return alert('꽉 찼습니다.');
            let pass = room.isLocked ? prompt('비밀번호:') : '';
            if (room.isLocked && pass === null) return;
            socket.emit('joinRoom', { roomName: room.name, password: pass });
        };
        roomListDiv.appendChild(div);
    });
});

// [4] 게임 입장 & 준비/시작 로직
socket.on('roomJoined', (data) => {
    myColor = data.color;
    amIHost = data.isHost; // 내가 방장인지 저장

    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('room-title').innerText = `방: ${data.roomName}`;
    
    // 버튼 초기화
    btnReady.classList.add('hidden');
    btnStart.classList.add('hidden');
    btnReady.innerText = "준비하기";
    
    // 방장은 시작 버튼, 참여자는 준비 버튼 표시
    if (amIHost) {
        btnStart.classList.remove('hidden');
    } else {
        btnReady.classList.remove('hidden');
    }

    chatMsgs.innerHTML = '';
    board.innerHTML = '';
    initBoard();
});

// 플레이어 상태 업데이트
socket.on('updatePlayers', (data) => {
    const players = data.players;
    const p2Ready = data.p2Ready;

    const p1 = players.find(p => p.color === 'black');
    const p2 = players.find(p => p.color === 'white');

    let p1Text = p1 ? `⚫${p1.name}(방장)` : '⚫대기중';
    let p2Text = p2 ? `⚪${p2.name}` : '⚪대기중';

    // 준비 상태 표시
    if (p2 && p2Ready) p2Text += " [준비완료!]";

    document.getElementById('player-list').innerText = `${p1Text} vs ${p2Text}`;

    // 내가 방장이면, 상대가 준비했을 때만 시작 버튼 활성화 (색상 변경 등)
    if (amIHost) {
        btnStart.disabled = !p2Ready; // 준비 안 하면 클릭 불가
        btnStart.style.opacity = p2Ready ? 1 : 0.5;
    }
});

function toggleReady() {
    socket.emit('toggleReady');
    // 버튼 텍스트 토글
    if (btnReady.innerText === "준비하기") {
        btnReady.innerText = "준비취소";
        btnReady.style.background = "red";
    } else {
        btnReady.innerText = "준비하기";
        btnReady.style.background = "green";
    }
}

function startGame() {
    socket.emit('startGame');
}

// 게임 시작 신호
socket.on('gameStart', (msg) => {
    alert(msg);
    statusDiv.innerText = msg;
    // 게임 시작되면 버튼들 숨김
    btnReady.classList.add('hidden');
    btnStart.classList.add('hidden');
});

// [5] 오목판 및 게임 로직
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
    try { soundStone.play(); } catch(e) {}
});

socket.on('status', (msg) => statusDiv.innerText = msg);
socket.on('timerUpdate', (time) => {
    timerSpan.innerText = time;
    timerSpan.style.color = time <= 5 ? 'red' : 'black';
});

socket.on('gameOver', (data) => {
    if (data.winner === myName) {
        try { soundWin.play(); } catch(e) {}
        alert(`🎉 승리! ${data.msg}`);
    } else {
        try { soundLose.play(); } catch(e) {}
        alert(`😭 패배... ${data.msg}`);
    }
    // 게임 끝나면 로비로 이동 (자동 로그인됨)
    location.reload(); 
});

socket.on('forceLeave', () => {
    alert("상대방이 나가서 대기실로 이동합니다.");
    location.reload();
});

socket.on('error', (msg) => alert(msg));
function leaveRoom() { socket.emit('leaveRoom'); location.reload(); }

// [6] 게임방 채팅
function sendChat() {
    const input = document.getElementById('chat-input');
    if (input.value.trim()) {
        socket.emit('chat', input.value);
        input.value = '';
    }
}
socket.on('chat', (data) => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<b>${data.sender}:</b> ${data.msg}`;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
});