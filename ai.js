// ai.js
// 오목 AI: 절대 방어 우선 (Defense First)

const BOARD_SIZE = 19;

// 우선순위 점수 (방어가 공격보다 높아야 안 짐)
const SCORE = {
    WIN: 100000,        // 나: 5목 완성 (승리)
    BLOCK_WIN: 90000,   // 적: 4목 방어 (필수)
    OPEN_4: 80000,      // 나: 열린 4목 (승리 확정)
    BLOCK_OPEN_3: 70000,// 적: 열린 3목 방어 (매우 위험)
    OPEN_3: 50000,      // 나: 열린 3목
    Make_4: 10000,      // 나: 4목 만들기
    Normal: 10          // 일반 착수
};

function getBestMove(board, difficulty) {
    // 돌이 하나도 없으면 중앙 착수
    if (isEmptyBoard(board)) return { x: 9, y: 9 };

    let bestScore = -Infinity;
    let moves = [];

    // 돌이 있는 곳 주변만 탐색 (성능 최적화)
    const candidates = getNeighboringMoves(board, 2);

    for (const move of candidates) {
        const x = move.x;
        const y = move.y;
        let score = 0;

        // 1. [공격] 내가 여기에 뒀을 때의 가치
        score += evaluateMove(board, x, y, 'white', 'attack');

        // 2. [방어] 상대가 여기에 뒀을 때의 위험도 (내가 막아야 할 가치)
        // 난이도가 '상'이면 방어 점수를 1.2배로 뻥튀기해서 무조건 막게 함
        let defenseMultiplier = difficulty === 'hard' ? 1.5 : (difficulty === 'medium' ? 1.0 : 0.5);
        score += evaluateMove(board, x, y, 'black', 'defense') * defenseMultiplier;

        // 위치 가중치 (중앙에 둘수록 약간의 가산점)
        score += (10 - Math.abs(x - 9) - Math.abs(y - 9));

        // 랜덤성 (난이도 조절용)
        if (difficulty === 'easy') score += Math.random() * 5000; 

        if (score > bestScore) {
            bestScore = score;
            moves = [move];
        } else if (score === bestScore) {
            moves.push(move);
        }
    }

    // 같은 점수 중 랜덤 선택
    if (moves.length > 0) return moves[Math.floor(Math.random() * moves.length)];
    return { x: 9, y: 9 };
}

// 한 수의 가치를 평가하는 함수
function evaluateMove(board, x, y, color, mode) {
    // 가상의 돌을 둬봄
    board[y][x] = color;
    let totalScore = 0;

    // 4방향 체크
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    
    for (let [dx, dy] of directions) {
        const lineInfo = getLineInfo(board, x, y, dx, dy, color);
        
        // 점수 부여 로직
        if (lineInfo.count >= 5) totalScore += SCORE.WIN; // 5목
        else if (lineInfo.count === 4) {
            if (lineInfo.openEnds > 0) totalScore += (mode === 'defense' ? SCORE.BLOCK_WIN : SCORE.OPEN_4); 
        }
        else if (lineInfo.count === 3) {
            if (lineInfo.openEnds === 2) totalScore += (mode === 'defense' ? SCORE.BLOCK_OPEN_3 : SCORE.OPEN_3);
            else if (lineInfo.openEnds === 1) totalScore += 1000; // 닫힌 3목
        }
        else if (lineInfo.count === 2) {
            if (lineInfo.openEnds === 2) totalScore += 100; // 열린 2목
        }
    }

    // 돌 원상복구
    board[y][x] = null;
    return totalScore;
}

// 특정 방향의 연속된 돌 개수와 열린 끝 개수 파악
function getLineInfo(board, x, y, dx, dy, color) {
    let count = 1;
    let openEnds = 0;

    // 정방향 탐색
    let i = 1;
    while (true) {
        const nx = x + dx * i;
        const ny = y + dy * i;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        
        if (board[ny][nx] === color) count++;
        else if (board[ny][nx] === null) { openEnds++; break; }
        else break; // 상대 돌 막힘
        i++;
    }

    // 역방향 탐색
    i = 1;
    while (true) {
        const nx = x - dx * i;
        const ny = y - dy * i;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        
        if (board[ny][nx] === color) count++;
        else if (board[ny][nx] === null) { openEnds++; break; }
        else break; // 상대 돌 막힘
        i++;
    }

    return { count, openEnds };
}

function getNeighboringMoves(board, range) {
    const candidates = new Set();
    const moves = [];
    
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] !== null) {
                for (let dy = -range; dy <= range; dy++) {
                    for (let dx = -range; dx <= range; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === null) {
                            const key = `${nx},${ny}`;
                            if (!candidates.has(key)) {
                                candidates.add(key);
                                moves.push({ x: nx, y: ny });
                            }
                        }
                    }
                }
            }
        }
    }
    if (moves.length === 0) return [{ x: 9, y: 9 }];
    return moves;
}

function isEmptyBoard(board) {
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] !== null) return false;
        }
    }
    return true;
}

module.exports = { getBestMove };
