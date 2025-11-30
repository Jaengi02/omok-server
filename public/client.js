const socket = io();

// UI Elements (변수는 늦게 할당되므로 let으로 선언)
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

// [NEW] BGM 및 활동 감지 변수
let activityTimer;
const PING_INTERVAL_MS = 10 * 60 * 1000;
let bgm;
let btnBgm;
let soundStone;
let soundWin;
let soundLose;

// -----------------------------------------------------------
// [0] 초기화 및 자동 로그인
// -----------------------------------------------------------

window.onload = () => {
    initializeTheme(); // 테마 초기화
    initializeDomElements(); // DOM 요소 초기화 (BGM 포함)

    const savedName = localStorage.getItem('omok-name');
    const savedPass = localStorage.getItem('omok-pass');
    if (savedName && savedPass) socket.emit('login', { name: savedName, password: savedPass });
};

// [NEW] 돔 요소 초기화 (BGM/사운드)
function initializeDomElements() {
    // 요소 할당
    bgm = document.getElementById('bgm');
    btnBgm = document.getElementById('btn-bgm');
    
    // BGM 설정
    if (bgm) {
        bgm.volume = 0.2; 
    }
    
    // 사운드 파일 할당
    soundStone = new Audio('stone.mp3');
    soundWin = new Audio('win.mp3');
    soundLose = new Audio('lose.mp3');
}

// [NEW] 테마 초기화 및 토글
function initializeTheme() {
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('theme') || 'dark'; // 기본 테마는 다크 모드
    root.setAttribute('data-theme', savedTheme);
    
    // 버튼 텍스트 초기화 (버튼이 HTML에 로드된 후 실행되도록 돔 로드 완료 시점에 설정)
    document.addEventListener('DOMContentLoaded', () => {
        const toggleButton = document.getElementById('btn-theme-toggle');
        if (toggleButton) {
            // 다크 모드일 때 "☀️ Light Mode" 표시, 라이트 모드일 때 "🌙 Dark Mode" 표시
            toggleButton.innerText = savedTheme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
        }
    });
}

function toggleTheme() {
    const root = document.documentElement;
    const currentTheme = root.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // 버튼 텍스트 변경
    // 새 테마가 다크 모드면 (즉, 버튼은 라이트 모드로 전환할 것을) "☀️ Light Mode" 표시
    document.getElementById('btn-theme-toggle').innerText = newTheme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
}

function login() {
    const name = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    if (!name || !pass) return alert('입력해주세요.');
    
    if (bgm) bgm.play().catch(e => console.log("BGM requires user interaction to play."));

    socket.emit('login', { name, password: pass });
}

function logout() {
    clearTimeout(activityTimer);
    localStorage.clear();
    location.reload();
}

// -----------------------------------------------------------
// [1] 이벤트 핸들러 및 기능
// -----------------------------------------------------------

socket.on('loginSuccess', (data) => {
    myName = data.name;
    localStorage.setItem('omok-name', document.getElementById('username').value || myName);
    const passVal = document.getElementById('password').value;
    if(passVal) localStorage.setItem('omok-pass', passVal);

    updateUserInfo(data);
    setupActivityMonitoring();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
});

socket.on('loginFail', (msg) => {
    localStorage.clear();
    alert(msg);
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.add('hidden');
});

// [활동 감지 로직]
function setupActivityMonitoring() {
    ['mousemove', 'keydown', 'scroll', 'click'].forEach(eventType => {
        document.addEventListener(eventType, resetActivityTimer);
    });
    resetActivityTimer();
}

function resetActivityTimer() {
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
        if (socket.connected) socket.emit('activity_ping');
        resetActivityTimer(); 
    }, PING_INTERVAL_MS);
}
socket.on('force_logout', (message) => { alert(message); logout(); });

function updateUserInfo(data) {
    document.getElementById('user-hello').innerText = `안녕하세요, ${data.name}님!`;
    document.getElementById('user-points').innerText = `${data.points} P`;
    
    const stats = data.stats || { wins: 0, loses: 0 };
    const total = stats.wins + stats.loses;
    const rate = total === 0 ? 0 : Math.round((stats.wins / total) * 100);
    document.getElementById('user-stats').innerText = `${stats.wins}승 ${stats.loses}패 (${rate}%)`;

    window.myItems = data.items || [];
    window.myEquipped = data.equipped || 'default';
}
socket.on('infoUpdate', updateUserInfo);

function openShop() {
    document.getElementById('shop-modal').classList.remove('hidden');
    document.getElementById('shop-modal').style.display = 'flex';
    document.getElementById('shop-points').innerText = '0 P';
    
    // [FIX] 상점 비활성화 로직: renderShopItems 대신 준비 중 메시지 표시
    document.getElementById('shop-items').innerHTML = 
        '<p style="color:#555;">(상점 기능은 잠시 준비 중입니다.)</p>';
}
function closeShop() {
    document.getElementById('shop-modal').classList.add('hidden');
    document.getElementById('shop-modal').style.display = 'none';
}

// [나머지 게임 로직은 유지]
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
        if (index === 0) p.style.color = '#d4af37';
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
        const statusText = room.isPlaying ? '게임중' : `대기중 (${room.count}/2)`;
        div.innerHTML = `<span>${room.name} ${lock}</span> <span class="${statusClass}">${statusText}</span>`;
        div.onclick = () => {
            let pass = room.isLocked ? prompt('비밀번호:') : '';
            if (room.isLocked && pass === null) return;
            socket.emit('joinRoom', { roomName: room.name, password: pass });
        };
        roomListDiv.appendChild(div);
    });
});

socket.on('roomJoined', (data) => {
    myColor = data.color;
    amIHost = data.isHost;
    isSpectator = data.isSpectator;

    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    document.getElementById('room-title').innerText = `방: ${data.roomName}`;
    
    btnReady.classList.add('hidden');
    btnStart.classList.add('hidden');
    spectatorMsg.classList.add('hidden');

    if (isSpectator) spectatorMsg.classList.remove('hidden');
    else {
        btnReady.innerText = "준비";
        if (amIHost) btnStart.classList.remove('hidden');
        else btnReady.classList.remove('hidden');
    }

    chatMsgs.innerHTML = '';
    initBoard(data.board);
});

socket.on('updateRoomInfo', (data) => {
    const { players, spectators, p2Ready } = data;
    const p1 = players.find(p => p.color === 'black');
    const p2 = players.find(p => p.color === 'white');
    let p1Text = p1 ? `⚫${p1.name}` : '⚫?';
    let p2Text = p2 ? `⚪${p2.name}` : '⚪?';
    if (p2 && p2Ready) p2Text += " [준비완료]";
    document.getElementById('player-list').innerText = `${p1Text} vs ${p2Text}`;

    spectatorListDiv.innerHTML = '';
    spectators.forEach(s => {
        const div = document.createElement('div');
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
    try { soundWin.play(); } catch(e){} 
    setTimeout(() => { alert(msg); statusDiv.innerText = msg; }, 100);
    btnReady.classList.add('hidden');
    btnStart.classList.add('hidden');
});

function initBoard(currentBoardData) {
    board.innerHTML = '';
    lastStoneElement = null;
    for (let y = 0; y < 19; y++) {
        for (let x = 0; x < 19; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.onclick = () => { if(!isSpectator && myColor) socket.emit('placeStone', { x, y }); };
            board.appendChild(cell);

            if (currentBoardData && currentBoardData[y][x]) {
                const parts = currentBoardData[y][x].split(':');
                const color = parts[0];
                const skin = parts[1] || 'default';
                
                const stone = document.createElement('div');
                stone.className = `stone ${color} ${skin}`;
                cell.appendChild(stone);
            }
        }
    }
}

socket.on('updateBoard', (data) => {
    const index = data.y * 19 + data.x;
    const cell = board.children[index];
    const stone = document.createElement('div');
    stone.className = `stone ${data.color} ${data.skin || 'default'}`;
    
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
    if (data.winner === myName) try { soundWin.play(); } catch(e){}
    else try { soundLose.play(); } catch(e){}
    
    setTimeout(() => { alert(`게임 종료! ${data.msg}`); location.reload(); }, 200);
});

socket.on('forceLeave', () => { alert("방 사라짐"); location.reload(); });
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
