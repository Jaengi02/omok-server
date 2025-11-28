// 파일명: public/client.js
const socket = io();
const board = document.getElementById('board');
const statusDiv = document.getElementById('status');
let myColor = null;

// [추가된 부분] 주소창(URL)에서 닉네임 가져오기
const params = new URLSearchParams(window.location.search);
const myName = params.get('name') || '이름없음';

// 서버에 접속하자마자 내 이름 알려주기
socket.emit('join', myName);

// 15x15 판 그리기 (기존과 동일)
for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.onclick = () => {
            if (myColor && !cell.hasChildNodes()) socket.emit('placeStone', { x, y });
        };
        board.appendChild(cell);
    }
}

// 초기 설정 (서버가 이름을 포함해서 정보를 줌)
socket.on('init', (data) => {
    myColor = data.color;
    // 내 돌 색깔과 이름 표시
    statusDiv.innerText = `환영합니다, ${myName}님! 당신은 ${myColor === 'black' ? '흑돌(⚫)' : '백돌(⚪)'}입니다.`;
    
    data.board.forEach((row, y) => row.forEach((c, x) => { if(c) draw(x, y, c); }));
});

// 게임 시작 알림 (상대방 이름도 표시)
socket.on('ready', (msg) => statusDiv.innerText = msg);

socket.on('updateBoard', (data) => draw(data.x, data.y, data.color));

// 턴 변경 알림 (이름으로 표시)
socket.on('turnChange', (data) => {
    if (myColor === data.currentTurn) {
        statusDiv.innerText = `${data.message} (당신의 차례!)`;
        statusDiv.style.color = "blue";
    } else {
        statusDiv.innerText = data.message;
        statusDiv.style.color = "black";
    }
});

socket.on('gameOver', (msg) => alert(msg));
socket.on('reset', (msg) => {
    alert(msg);
    document.querySelectorAll('.cell').forEach(c => c.innerHTML = '');
});
socket.on('full', (msg) => { alert(msg); window.location.href = '/'; }); // 꽉 차면 로그인으로 튕김

function draw(x, y, c) {
    const cell = board.children[y * 15 + x];
    if (!cell.hasChildNodes()) {
        const stone = document.createElement('div');
        stone.className = `stone ${c}`;
        cell.appendChild(stone);
    }
}