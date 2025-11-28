const socket = io();

// UI Elements
const board = document.getElementById('board');
const statusDiv = document.getElementById('status');
const roomListDiv = document.getElementById('room-list');
const rankingDiv = document.getElementById('ranking-list');
const onlineListDiv = document.getElementById('online-user-list');
const onlineCountSpan = document.getElementById('online-count');
const timerSpan = document.getElementById('timer');
const chatMsgs = document.getElementById('chat-messages');
const spectatorListDiv = document.getElementById('spectator-list');

const btnReady = document.getElementById('btn-ready');
const btnStart = document.getElementById('btn-start');
const spectatorMsg = document.getElementById('spectator-msg');

let myColor = null;
let myName = null;
let amIHost = false;
let isSpectator = false;
let lastStoneElement = null;

// 🔊 Sound
const soundStone = new Audio('stone.mp3');
const soundWin = new Audio('win.mp3');
const soundLose = new Audio('lose.mp3');

// [0] Auto Login
window.onload = () => {
    const savedName = localStorage.getItem('omok-name');
    const savedPass = localStorage.getItem('omok-pass');
    if (savedName && savedPass) socket.emit('login', { name: savedName, password: savedPass });
};

function login() {
    const name = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    if (!name || !pass) return alert('입력해주세요.');
    socket.emit('login', { name, password: pass });
}

function logout() {
    if(confirm('로그아웃?')) {
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

    updateUserStats(stats);
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
});

socket.on('loginFail', (msg) => {
    localStorage.clear();
    alert(msg);
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('lobby-screen').classList.add('hidden');
});

function updateUserStats(stats) {
    const total = stats.wins + stats.loses;
    const rate = total === 0 ? 0 : Math.round((stats.wins / total) * 100);
    document.getElementById('user-stats').innerText = `${stats.wins}승 ${stats.loses}패 (${rate}%)`;
}
socket.on('statsUpdate', updateUserStats);

socket.on('userListUpdate', (userList) => {
    onlineCountSpan.innerText = userList.length;
    onlineListDiv.innerText = userList.join(', ');
});

function sendLobbyChat() {
    const input = document.getElementById('lobby-chat-input');
    if(input.value.trim()) { socket.emit('lobbyChat', input.value); input.value = ''; }
}
socket.on('lobbyChat', (data) => {
    const box = document.getElementById('lobby-chat-box');
    const p = document.createElement('div');
    p.innerHTML = `<b>${data.sender}:</b> ${data.msg}`;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
});

socket.on('rankingUpdate', (rankList) => {
    rankingDiv.innerHTML = '';
    rankList.forEach((user, index) => {
        const p = document.createElement('p');
        p.innerText = `${index+1}위: ${user.name} (${user.wins}승)`;
        if(index===0) p.style.color='#d4af37';
        rankingDiv.appendChild(p);
    });
});

function createRoom() {
    const name = document.getElementById('create-room-name').value;
    const pass = document.getElementById('create-room-pass').value;
    if (!name) return alert('방 제목?');
    socket.emit('createRoom', { roomName: name, password: pass });
}

socket.on('roomListUpdate', (rooms) => {
    roomListDiv.innerHTML = '';
    if (rooms.length === 0) { roomListDiv.innerHTML = '<p>방이 없습니다.</p>'; return; }
    rooms.forEach((room) => {
        const div = document.createElement('div');
        div.className = 'room-item';
        const lock = room.isLocked ? '🔒' : '';
        const statusClass = room.isPlaying ? 'room-status-playing' : 'room-status-waiting';
        const statusText = room.isPlaying ? '게임중 (관전가능)' : `대기중 (${room.count}/2)`;
        
        div.innerHTML = `<span>${room.name} ${lock}</span> <span class="${statusClass}">${statusText}</span>`;
        div.onclick = () => {
            let pass = room.isLocked ? prompt('비밀번호:') : '';
            if (room.isLocked && pass === null) return;
            socket.emit('joinRoom', { roomName: room.name, password: pass });
        };
        roomListDiv.appendChild(div);
    });
});

// [게임 입장 & 관전 처리]
socket.on('roomJoined', (data) => {
    myColor = data.color;
    amIHost = data.isHost;
    isSpectator = data.isSpectator;

    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('room-title').innerText = `방: ${data.roomName}`;
    
    // 버튼 초기화
    btnReady.classList.add('hidden');
    btnStart.classList.add('hidden');
    spectatorMsg.classList.add('hidden');

    if (isSpectator) {
        spectatorMsg.classList.remove('hidden');
    } else {
        btnReady.innerText = "준비하기";
        if (amIHost) btnStart.classList.remove('hidden');
        else btnReady.classList.remove('hidden');
    }

    chatMsgs.innerHTML = '';
    initBoard(data.board); // 기존에 놓인 돌이 있으면 그림
});

socket.on('updateRoomInfo', (data) => {
    const { players, spectators, p2Ready } = data;
    
    // 플레이어 표시
    const p1 = players.find(p => p.color === 'black');
    const p2 = players.find(p => p.color === 'white');
    let p1Text = p1 ? `⚫${p1.name}` : '⚫?';
    let p2Text = p2 ? `⚪${p2.name}` : '⚪?';
    if (p2 && p2Ready) p2Text += " [준비됨]";
    document.getElementById('player-list').innerText = `${p1Text} vs ${p2Text}`;

    // 관전자 표시
    spectatorListDiv.innerHTML = '';
    spectators.forEach(s => {
        const div = document.createElement('div');
        div.className = 'spectator-item';
        div.innerText = `👤 ${s.name}`;
        spectatorListDiv.appendChild(div);
    });

    if (amIHost && !isSpectator) {
        btnStart.disabled = !p2Ready;
        btnStart.style.opacity = p2Ready ? 1 : 0.5;
    }
});

function toggleReady() { socket.emit('toggleReady'); }
function startGame() { socket.emit('startGame'); }

socket.on('gameStart', (msg) => {
    // 🔊 소리 재생 후 알림 (alert가 소리 끊는거 방지)
    try { soundWin.play(); } catch(e){} 
    setTimeout(() => { alert(msg); statusDiv.innerText = msg; }, 100);
    
    btnReady.classList.add('hidden');
    btnStart.classList.add('hidden');
});

// [19x19 보드 초기화]
function initBoard(currentBoardData) {
    board.innerHTML = '';
    lastStoneElement = null;
    
    // 19 x 19 반복
    for (let y = 0; y < 19; y++) {
        for (let x = 0; x < 19; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            // 관전자는 클릭해도 소용없지만 이벤트는 달아둠 (서버에서 막음)
            cell.onclick = () => { if(!isSpectator && myColor) socket.emit('placeStone', { x, y }); };
            board.appendChild(cell);

            // 이미 놓인 돌이 있다면 그리기 (관전자용)
            if (currentBoardData && currentBoardData[y][x]) {
                const stone = document.createElement('div');
                stone.className = `stone ${currentBoardData[y][x]}`;
                cell.appendChild(stone);
            }
        }
    }
}

socket.on('updateBoard', (data) => {
    const index = data.y * 19 + data.x; // 19줄이라 인덱스 계산 변경
    const cell = board.children[index];
    const stone = document.createElement('div');
    stone.className = `stone ${data.color}`;
    
    if (lastStoneElement) lastStoneElement.classList.remove('last-move');
    stone.classList.add('last-move');
    lastStoneElement = stone;

    cell.appendChild(stone);
    try { soundStone.play(); } catch(e) {}
});

socket.on('status', (msg) => statusDiv.innerText = msg);
socket.on('timerUpdate', (time) => {
    timerSpan.innerText = time;
    timerSpan.style.color = time <= 5 ? 'red' : 'black';
});

socket.on('gameOver', (data) => {
    // 🔊 소리 재생 후 알림
    if (data.winner === myName) {
        try { soundWin.play(); } catch(e){}
    } else {
        try { soundLose.play(); } catch(e){}
    }
    
    setTimeout(() => {
        alert(`게임 종료! ${data.msg}`);
        location.reload(); 
    }, 200); // 0.2초 딜레이
});

socket.on('forceLeave', () => { alert("방이 사라졌습니다."); location.reload(); });
socket.on('error', (msg) => alert(msg));
function leaveRoom() { socket.emit('leaveRoom'); location.reload(); }

function sendChat() {
    const input = document.getElementById('chat-input');
    if (input.value.trim()) { socket.emit('chat', input.value); input.value = ''; }
}
socket.on('chat', (data) => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<b>${data.sender}:</b> ${data.msg}`;
    chatMsgs.appendChild(div);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
});