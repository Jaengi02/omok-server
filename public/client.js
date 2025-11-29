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

let activityTimer;
const PING_INTERVAL_MS = 10 * 60 * 1000;

// [FIXED] BGM 변수를 미리 선언만 해둡니다. (null 방지)
let bgm;
let btnBgm;
let soundStone;
let soundWin;
let soundLose;

// -----------------------------------------------------------
// [NEW] 돔 요소 초기화 함수: window.onload 때 호출됨
// -----------------------------------------------------------
function initializeDomElements() {
    // [FIX] ID를 찾아 변수에 할당합니다.
    bgm = document.getElementById('bgm');
    btnBgm = document.getElementById('btn-bgm');
    
    // [FIX] 이 초기화가 성공해야 볼륨 설정이 가능합니다.
    if (bgm) {
        bgm.volume = 0.2; 
    }
    
    // [NEW] 효과음도 여기서 초기화 (오류 방지)
    soundStone = new Audio('stone.mp3');
    soundWin = new Audio('win.mp3');
    soundLose = new Audio('lose.mp3');
}

// [0] 자동 로그인
window.onload = () => {
    initializeDomElements(); // 👈 DOM 요소 먼저 초기화
    
    const savedName = localStorage.getItem('omok-name');
    const savedPass = localStorage.getItem('omok-pass');
    if (savedName && savedPass) socket.emit('login', { name: savedName, password: savedPass });
};

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

// [BGM 토글 함수]
function toggleBgm() {
    if (!bgm) return; // 요소 없으면 무시
    
    if (bgm.paused) {
        bgm.play().catch(e => console.log("BGM requires user interaction to play."));
        btnBgm.innerText = "🎵 BGM ON";
        btnBgm.classList.remove('bgm-off');
    } else {
        bgm.pause();
        btnBgm.innerText = "🔇 BGM OFF";
        btnBgm.classList.add('bgm-off');
    }
}


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

// [NEW] 활동 감지 로직
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
    document.getElementById('shop-points').innerText = document.getElementById('user-points').innerText.replace(' P','');
    renderShopItems();
}
function closeShop() {
    document.getElementById('shop-modal').classList.add('hidden');
    document.getElementById('shop-modal').style.display = 'none';
}

function renderShopItems() { 
    const items = [
        { id: 'default', name: '기본돌', price: 0 },
        { id: 'gold', name: '황금돌', price: 500 },
        { id: 'diamond', name: '다이아', price: 1000 },
        { id: 'ruby', name: '루비', price: 2000 }
    ];
    
    const container = document.getElementById('shop-items');
    container.innerHTML = '';

    items.forEach(item => {
        const div = document.createElement('div');
        div.style.border = '1px solid #ddd';
        div.style.padding = '10px';
        div.style.borderRadius = '10px';
        div.style.width = '100px';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'center';
        div.style.background = '#fff';

        const previewBox = document.createElement('div');
        previewBox.style.display = 'flex';
        previewBox.style.gap = '5px';
        previewBox.style.marginBottom = '8px';
        
        const blackStone = document.createElement('div');
        blackStone.className = `stone black ${item.id}`; 
        blackStone.style.width = '35px';
        blackStone.style.height = '35px';
        blackStone.style.boxShadow = '1px 1px 3px rgba(0,0,0,0.3)';

        const whiteStone = document.createElement('div');
        whiteStone.className = `stone white ${item.id}`;
        whiteStone.style.width = '35px';
        whiteStone.style.height = '35px';
        whiteStone.style.boxShadow = '1px 1px 3px rgba(0,0,0,0.3)';

        previewBox.append(blackStone, whiteStone);

        const name = document.createElement('div');
        name.innerText = item.name;
        name.style.fontWeight = 'bold';
        name.style.fontSize = '14px';
        
        const price = document.createElement('div');
        price.innerText = `${item.price}P`;
        price.style.color = '#555';
        price.style.fontSize = '12px';
        
        const btn = document.createElement('button');
        btn.style.marginTop = '5px';
        btn.style.fontSize = '12px';
        btn.style.padding = '5px 10px';
        btn.style.width = '100%';

        if (window.myItems.includes(item.id)) {
            if (window.myEquipped === item.id) {
                btn.innerText = '장착중';
                btn.disabled = true;
                btn.style.background = '#555';
                btn.style.color = 'white';
                btn.style.border = '1px solid #555';
            } else {
                btn.innerText = '장착';
                btn.style.background = 'white';
                btn.style.color = '#333';
                btn.style.border = '1px solid #ccc';
                btn.onclick = () => socket.emit('equipItem', item.id);
            }
        } else {
            btn.innerText = '구매';
            btn.style.background = '#e3c586';
            btn.style.color = 'black';
            btn.onclick = () => {
                if(confirm(`${item.name}을(를) ${item.price}포인트에 구매하시겠습니까?`)) {
                    socket.emit('buyItem', item.id);
                }
            };
        }

        div.append(previewBox, name, price, btn);
        container.appendChild(div);
    });
}

socket.on('shopUpdate', (data) => {
    document.getElementById('user-points').innerText = `${data.points} P`;
    document.getElementById('shop-points').innerText = data.points;
    window.myItems = data.items;
    window.myEquipped = data.equipped;
    renderShopItems();
});
socket.on('alert', (msg) => alert(msg));


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
