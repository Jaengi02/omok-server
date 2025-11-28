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

// [Sound]
const soundStone = new Audio('stone.mp3');
const soundWin = new Audio('win.mp3');
const soundLose = new Audio('lose.mp3');

// [Auto Login]
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
        localStorage.clear();
        location.reload();
    }
}

// [Login Success]
socket.on('loginSuccess', (data) => {
    myName = data.name;
    localStorage.setItem('omok-name', document.getElementById('username').value || myName);
    const passVal = document.getElementById('password').value;
    if(passVal) localStorage.setItem('omok-pass', passVal);

    updateUserInfo(data); // 정보 갱신
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
});

socket.on('loginFail', (msg) => {
    localStorage.clear();
    alert(msg);
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('lobby-screen').classList.add('hidden');
});

// [User Info Update]
function updateUserInfo(data) {
    document.getElementById('user-hello').innerText = `안녕하세요, ${data.name}님!`;
    document.getElementById('user-points').innerText = `${data.points} P`;
    
    const stats = data.stats || { wins: 0, loses: 0 };
    const total = stats.wins + stats.loses;
    const rate = total === 0 ? 0 : Math.round((stats.wins / total) * 100);
    document.getElementById('user-stats').innerText = `${stats.wins}승 ${stats.loses}패 (${rate}%)`;

    // 상점용 데이터 저장
    window.myItems = data.items || [];
    window.myEquipped = data.equipped || 'default';
}
socket.on('infoUpdate', updateUserInfo); // 실시간 포인트/전적 갱신

// [Shop Logic]
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
        { id: 'default', name: '기본돌', price: 0, color: '#333' },
        { id: 'gold', name: '황금돌', price: 500, color: 'gold' },
        { id: 'diamond', name: '다이아', price: 1000, color: 'cyan' },
        { id: 'ruby', name: '루비', price: 2000, color: 'red' }
    ];
    
    const container = document.getElementById('shop-items');
    container.innerHTML = '';

    items.forEach(item => {
        const div = document.createElement('div');
        div.style.border = '1px solid #ddd';
        div.style.padding = '10px';
        div.style.borderRadius = '5px';
        div.style.width = '80px';

        // 돌 미리보기
        const preview = document.createElement('div');
        preview.style.width = '30px'; preview.style.height = '30px';
        preview.style.borderRadius = '50%'; preview.style.margin = '0 auto 5px auto';
        preview.style.backgroundColor = item.color;
        if(item.id === 'gold') preview.style.border = '2px solid orange';

        const name = document.createElement('div');
        name.innerText = item.name;
        const price = document.createElement('div');
        price.innerText = `${item.price}P`;
        
        const btn = document.createElement('button');
        btn.style.marginTop = '5px';
        btn.style.fontSize = '12px';
        btn.style.padding = '5px';

        if (window.myItems.includes(item.id)) {
            if (window.myEquipped === item.id) {
                btn.innerText = '장착중';
                btn.disabled = true;
                btn.style.background = '#aaa';
            } else {
                btn.innerText = '장착';
                btn.onclick = () => socket.emit('equipItem', item.id);
            }
        } else {
            btn.innerText = '구매';
            btn.onclick = () => {
                if(confirm(`${item.price}포인트를 사용하여 구매하시겠습니까?`)) {
                    socket.emit('buyItem', item.id);
                }
            };
        }

        div.append(preview, name, price, btn);
        container.appendChild(div);
    });
}

socket.on('shopUpdate', (data) => {
    // 구매/장착 후 데이터 갱신
    document.getElementById('user-points').innerText = `${data.points} P`;
    document.getElementById('shop-points').innerText = data.points;
    window.myItems = data.items;
    window.myEquipped = data.equipped;
    renderShopItems(); // 상점 화면 다시 그리기
});
socket.on('alert', (msg) => alert(msg));


// [Basic Features]
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

// [Game Logic]
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
                // stoneValue = "black:gold" -> split -> color="black", skin="gold"
                const parts = currentBoardData[y][x].split(':');
                const color = parts[0];
                const skin = parts[1] || 'default';
                
                const stone = document.createElement('div');
                stone.className = `stone ${color} ${skin}`; // 스킨 클래스 추가
                cell.appendChild(stone);
            }
        }
    }
}

socket.on('updateBoard', (data) => {
    const index = data.y * 19 + data.x;
    const cell = board.children[index];
    const stone = document.createElement('div');
    // 스킨 적용 (data.skin)
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