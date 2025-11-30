// ai.js
// 강력한 패턴 매칭 기반 오목 AI (Minimax Lite)

const BOARD_SIZE = 19;

// [점수표] 점수가 높을수록 AI가 선호하는 자리
// 수비 점수를 공격 점수보다 조금 더 높게 잡아서, 상대방 막는 걸 최우선으로 함
const SCORES = {
    WIN: 100000000,       // 5목 (승리)
    BLOCK_WIN: 90000000,  // 상대 5목 방어
    OPEN_4: 10000000,     // 양쪽 뚫린 4 (다음 턴 필승)
    BLOCK_OPEN_4: 9000000,// 상대 양쪽 뚫린 4 방어
    CLOSED_4: 500000,     // 한쪽 막힌 4
    OPEN_3: 400000,       // 양쪽 뚫린 3
    BLOCK_OPEN_3: 350000, // 상대 양쪽 뚫린 3 방어
    CLOSED_3: 1000,       // 한쪽 막힌 3
    OPEN_2: 1000,         // 양쪽 뚫린 2
    CLOSED_2: 100         // 한쪽 막힌 2
};

function getBestMove(board, difficulty) {
    // 돌이 하나도 없으면 천원(중앙)에 둠
    if (isEmptyBoard(board)) return { x: 9, y: 9 };

    let bestScore = -Infinity;
    let moves = [];

    // 후보군 선정: 돌이 있는 곳 주변 2칸 이내만 탐색 (계산 속도 향상)
    const candidates = getNeighboringMoves(board, 2);

    for (const move of candidates) {
        const x = move.x;
        const y = move.y;

        // 1. 공격 점수 계산 (내가 여기에 두면 얼마나 좋은가?)
        let attackScore = evaluatePosition(board, x, y, 'white');

        // 2. 수비 점수 계산 (상대가 여기에 두면 얼마나 위험한가?)
        let defenseScore = evaluatePosition(board, x, y, 'black');

        // 3. 최종 점수 합산
        // 난이도가 높을수록 수비(defense) 비중을 높여서 끈질기게 만듦
        let totalScore = 0;
        
        if (difficulty === 'hard') {
            // 상: 공격과 수비 모두 완벽하게 고려, 당장 죽는 수는 무조건 막음
            if (attackScore >= SCORES.WIN) totalScore = SCORES.WIN; // 내가 이기면 끝
            else if (defenseScore >= SCORES.WIN) totalScore = SCORES.BLOCK_WIN; // 상대 이김 방어
            else if (attackScore >= SCORES.OPEN_4) totalScore = SCORES.OPEN_4; // 내 필승
            else if (defenseScore >= SCORES.OPEN_4) totalScore = SCORES.BLOCK_OPEN_4; // 상대 필승 방어
            else totalScore = attackScore + defenseScore;
        } 
        else if (difficulty === 'medium') {
            // 중: 수비를 하긴 하지만 가끔 놓침
            totalScore = attackScore + (defenseScore * 0.8);
        } 
        else {
            // 하: 공격만 생각하고 수비는 대충 함
            totalScore = attackScore + (defenseScore * 0.2) + (Math.random() * 500);
        }

        if (totalScore > bestScore) {
            bestScore = totalScore;
            moves = [move];
        } else if (totalScore === bestScore) {
            moves.push(move);
        }
    }

    // 같은 점수라면 무작위 선택 (예측 불가능하게)
    if (moves.length > 0) {
        return moves[Math.floor(Math.random() * moves.length)];
    }
    return { x: 9, y: 9 };
}

// 해당 좌표의 가치를 4방향(ㅡ, ㅣ, /, \)으로 평가
function evaluatePosition(board, x, y, color) {
    let score = 0;
    
    // 가로, 세로, 대각선, 역대각선
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

    for (let [dx, dy] of directions) {
        // 해당 방향의 라인을 문자열로 추출 (예: "XX_O_XX")
        const lineStr = getLineString(board, x, y, dx, dy, color);
        score += getPatternScore(lineStr);
    }
    return score;
}

// 보드에서 특정 라인을 문자열로 변환 (O: 내돌, X: 상대돌, _: 빈칸)
// 가상의 돌(현재 두려는 위치)은 'M'으로 표시
function getLineString(board, x, y, dx, dy, color) {
    let str = "";
    // 앞뒤로 4칸씩 확인
    for (let i = -4; i <= 4; i++) {
        const nx = x + dx * i;
        const ny = y + dy * i;

        if (i === 0) {
            str += "M"; // 내가 둘 자리
        } else if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) {
            str += "X"; // 벽은 상대 돌로 취급 (막힌 것)
        } else {
            const cell = board[ny][nx];
            if (cell === null) str += "_";
            else if (cell === color) str += "O"; // 같은 편
            else str += "X"; // 다른 편
        }
    }
    return str;
}

// 패턴에 따른 점수 부여 (핵심 지능)
function getPatternScore(str) {
    // M을 포함한 패턴 검사
    
    // 5목 (승리)
    if (str.includes('MMMMM') || str.includes('OMMMM') || str.includes('MOMMM') || str.includes('MMOMM') || str.includes('MMMOM') || str.includes('MMMMO')) return SCORES.WIN;
    // 이미 4개가 있고 내가 둬서 5개가 되는 경우 (OOOO_) -> (OOOOM)
    if (str.match(/O{4}M|MO{4}|O{3}MO|OMO{3}|O{2}MO{2}/)) return SCORES.WIN;

    // 열린 4 ( _MMMM_ ) -> 무조건 승리
    if (str.match(/_M{4}_|_OMMM_|_MMOM_|_MMMOM_|_MMMO_/)) return SCORES.OPEN_4;
    
    // 닫힌 4 ( XMMMM_ )
    if (str.match(/X?M{4}_|_M{4}X?|X?OMMM_|_MMMOX?/)) return SCORES.CLOSED_4;

    // 열린 3 ( _MMM_ ) -> 다음 턴에 열린 4가 됨
    if (str.match(/_M{3}_|_OMM_|_MMO_|_MOM_/)) return SCORES.OPEN_3;
    if (str.match(/_M_MM_|_MM_M_/)) return SCORES.OPEN_3; // 징검다리 3

    // 닫힌 3
    if (str.match(/X?M{3}_|_M{3}X?/)) return SCORES.CLOSED_3;

    // 열린 2
    if (str.match(/_M{2}_|_OM_|_MO_/)) return SCORES.OPEN_2;

    return 0;
}

// 최적화를 위해 돌 주변만 탐색
function getNeighboringMoves(board, range) {
    const candidates = new Set();
    const moves = [];
    
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] !== null) {
                // 돌이 있는 곳 주변 range 칸 이내의 빈칸을 찾음
                for (let dy = -range; dy <= range; dy++) {
                    for (let dx = -range; dx <= range; dx++) {
                        const ny = y + dy;
                        const nx = x + dx;
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
    // 판이 비어있으면 중앙만 반환
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
