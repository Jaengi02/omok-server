// ai.js
// 오목 AI 로직 (Minimax Algorithm with Alpha-Beta Pruning)

const BOARD_SIZE = 19;

// 점수 체계 (가중치)
const SCORE = {
    WIN: 100000000,     // 승리 (5목)
    OPEN_4: 10000000,   // 열린 4 (무조건 승리)
    CLOSED_4: 100000,   // 닫힌 4
    OPEN_3: 100000,     // 열린 3 (매우 위협적)
    CLOSED_3: 1000,     // 닫힌 3
    OPEN_2: 1000,       // 열린 2
    CLOSED_2: 100       // 닫힌 2
};

// 난이도별 탐색 깊이 (Depth) 설정
// 깊을수록 똑똑하지만 계산 시간이 오래 걸립니다.
const DEPTH_LIMIT = {
    'easy': 1,   // 1수 앞 (단순)
    'medium': 2, // 2수 앞 (기본 수읽기)
    'hard': 3    // 3수 앞 (심화 수읽기 - 웹 서버 부하 고려하여 3으로 제한)
};

// 메인 함수: 최적의 수를 반환
function getBestMove(board, difficulty) {
    const depth = DEPTH_LIMIT[difficulty] || 1;
    
    // 1. 둘 수 있는 후보들을 먼저 추립니다. (모든 빈칸을 다 계산하면 너무 느림)
    const moves = getCandidateMoves(board);
    
    // 첫 수라면 중앙 근처에 둠
    if (moves.length === 0 && board[9][9] === null) return { x: 9, y: 9 };
    if (moves.length === 0) return getRandomMove(board);

    let bestMove = null;
    let bestScore = -Infinity;

    // 2. 후보들에 대해 미니맥스 알고리즘 실행
    for (const move of moves) {
        board[move.y][move.x] = 'white'; // AI가 둬봄
        
        // 상대방(흑)은 점수를 최소화하려 한다고 가정 (Min)
        let score = minimax(board, depth - 1, -Infinity, Infinity, false);
        
        board[move.y][move.x] = null; // 원상복구

        // 약간의 랜덤성 추가 (같은 점수일 때 다양한 플레이 유도)
        if (difficulty === 'easy') score += Math.random() * 500;
        
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    return bestMove || moves[0];
}

// 미니맥스 알고리즘 (Alpha-Beta Pruning 포함)
function minimax(board, depth, alpha, beta, isMaximizing) {
    // 종료 조건: 승패가 났거나, 깊이 제한에 도달했거나, 둘 곳이 없거나
    const evaluation = evaluateBoard(board);
    if (Math.abs(evaluation) > SCORE.OPEN_4 * 10) return evaluation; // 승리/패배 확정 시 즉시 반환
    if (depth === 0) return evaluation;

    const moves = getCandidateMoves(board);
    if (moves.length === 0) return 0;

    if (isMaximizing) { // AI 차례 (점수 최대화)
        let maxEval = -Infinity;
        for (const move of moves) {
            board[move.y][move.x] = 'white';
            const eval = minimax(board, depth - 1, alpha, beta, false);
            board[move.y][move.x] = null;
            
            maxEval = Math.max(maxEval, eval);
            alpha = Math.max(alpha, eval);
            if (beta <= alpha) break; // 가지치기 (Pruning)
        }
        return maxEval;
    } else { // 플레이어 차례 (점수 최소화 - AI에게 불리하게 둠)
        let minEval = Infinity;
        for (const move of moves) {
            board[move.y][move.x] = 'black';
            const eval = minimax(board, depth - 1, alpha, beta, true);
            board[move.y][move.x] = null;
            
            minEval = Math.min(minEval, eval);
            beta = Math.min(beta, eval);
            if (beta <= alpha) break; // 가지치기
        }
        return minEval;
    }
}

// 성능 최적화: 돌 주변 1~2칸 범위만 탐색 후보로 선정
function getCandidateMoves(board) {
    const candidates = new Set();
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1], [1, -1], [-1, 1], [-1, -1], [-1, 0]];

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] !== null) { // 돌이 있는 곳 주변을 탐색
                for (let [dx, dy] of directions) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] === null) {
                        // Set은 객체를 중복 제거 못하므로 문자열 키 사용
                        candidates.add(`${nx},${ny}`);
                    }
                }
            }
        }
    }

    // 문자열 키를 다시 객체로 변환
    return Array.from(candidates).map(c => {
        const [x, y] = c.split(',').map(Number);
        return { x, y };
    });
}

// 전체 판세 평가 함수
function evaluateBoard(board) {
    let score = 0;
    
    // 전체 보드를 훑으며 AI(white)는 +, 유저(black)는 - 점수 부여
    // 가로, 세로, 대각선 모든 라인 평가
    score += evaluateAllLines(board, 'white');
    score -= evaluateAllLines(board, 'black') * 1.2; // 수비(상대방 견제)에 가중치를 더 줌

    return score;
}

function evaluateAllLines(board, color) {
    let totalScore = 0;
    // 4방향 검사 (가로, 세로, 대각선, 역대각선)
    // (성능을 위해 단순화된 평가 로직 사용)
    // 실제로는 여기서 3목, 4목 개수를 세서 점수를 매깁니다.
    
    // ... (이 부분은 너무 길어지므로 핵심 로직인 '연속된 돌 개수'를 세는 것으로 대체) ...
    // 간소화된 평가: 연속된 돌 + 열린 공간 확인
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === color) {
                for (let [dx, dy] of directions) {
                    totalScore += checkLine(board, x, y, dx, dy, color);
                }
            }
        }
    }
    return totalScore;
}

function checkLine(board, x, y, dx, dy, color) {
    // 이미 검사한 방향이면 패스 (중복 방지 로직은 생략하고 단순 계산)
    // 연속된 돌 개수 카운트
    let count = 0;
    let openEnds = 0;
    
    // 앞쪽 확인
    for (let i = 0; i < 5; i++) {
        const nx = x + dx * i;
        const ny = y + dy * i;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        if (board[ny][nx] === color) count++;
        else if (board[ny][nx] === null) { openEnds++; break; }
        else break; // 상대 돌 막힘
    }
    
    // 뒤쪽 확인 (시작점 바로 뒤)
    const bx = x - dx;
    const by = y - dy;
    if (bx >= 0 && bx < BOARD_SIZE && by >= 0 && by < BOARD_SIZE && board[by][bx] === null) {
        openEnds++;
    }

    if (count >= 5) return SCORE.WIN;
    if (count === 4) return openEnds === 2 ? SCORE.OPEN_4 : (openEnds === 1 ? SCORE.CLOSED_4 : 0);
    if (count === 3) return openEnds === 2 ? SCORE.OPEN_3 : (openEnds === 1 ? SCORE.CLOSED_3 : 0);
    if (count === 2) return openEnds === 2 ? SCORE.OPEN_2 : 0;
    return 0;
}

function getRandomMove(board) {
    const moves = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === null) moves.push({ x, y });
        }
    }
    return moves[Math.floor(Math.random() * moves.length)];
}

module.exports = { getBestMove };
