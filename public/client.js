// public/client.js
const socket = io();
const board = document.getElementById('board');
const statusDiv = document.getElementById('status');

// 화면 요소들
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const startBtn = document.getElementById('start-btn');
const waitingMsg = document.getElementById('waiting-msg');

let myColor = null;

// [1] 로그인 -> 로비 이동
function joinLobby() {
    const name = document.getElementById('username').value;
    if (!name) return alert("닉네임을 입력하세요");
    
    socket.emit('joinLobby', name);
    document.getElementById('user-hello').innerText = `반갑습니다, ${name}님!`;
    
    loginScreen.classList.add('hidden'); // 로그인 숨김
    lobbyScreen.classList.remove('hidden'); // 로비 보임
}

// [2] 게임 찾기 버튼 클릭
function requestGame() {
    socket.emit('requestGame');
}

// [3] 서버 응답 처리
// 대기 중일 때
socket.on('waiting', () => {
    startBtn.classList.add('hidden');
    waitingMsg.classList.remove('hidden');
});

// 게임 매칭 성공! (게임 화면으로 이동)
socket.on('gameStart', (data) => {
    myColor = data.color;
    // 로비 숨기고 게임 화면 보이기
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    // 오목판 초기화
    board.innerHTML = ''; 
    initBoard();
    
    const opponent = data.opponentName;
    const myRole = myColor === 'black' ? '흑돌(⚫)' : '백돌(⚪)';
    statusDiv.innerText = `VS ${opponent} | 당신은 ${myRole}입니다.`;
});

// 오목판 그리기 함수
function initBoard() {
    for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 15; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.onclick = () => {
                if (myColor) socket.emit('placeStone', { x, y });
            };
            board.appendChild(cell);
        }
    }
}

// 게임 진행 로직 (기존과 동일)
socket.on('updateBoard', ({ x, y, color }) => {
    const cell = board.children[y * 15 + x];
    const stone = document.createElement('div');
    stone.className = `stone ${color}`;
    cell.appendChild(stone);
});

socket.on('turnChange', ({ turn }) => {
    const isMyTurn = myColor === turn;
    statusDiv.style.color = isMyTurn ? 'blue' : 'black';
    statusDiv.innerText = isMyTurn ? "당신의 차례입니다!" : "상대방 생각 중...";
});

socket.on('gameOver', (msg) => {
    alert(msg);
    location.reload(); // 확인 누르면 새로고침 (로비로 돌아감)
});

socket.on('userCount', (count) => {
    document.getElementById('user-count').innerText = count;
});