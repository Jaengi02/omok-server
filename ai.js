// ai.js
// 오목 AI 로직 (Heuristic Evaluation)

const BOARD_SIZE = 19;

// 패턴에 따른 점수표
const SCORES = {
    WIN: 10000000,      // 5목 (승리)
    OPEN_4: 1000000,    // 양쪽 뚫린 4 (다음 턴 승리 확정)
    CLOSED_4: 100000,   // 한쪽 막힌 4
    OPEN_3: 100000,     // 양쪽 뚫린 3
    CLOSED_3: 1000,     // 한쪽 막힌 3
    OPEN_2: 1000,       // 양쪽 뚫린 2
    CLOSED_2: 100       // 한쪽 막힌 2
};

function getBestMove(board, difficulty) {
    let bestScore = -Infinity;
    let moves = [];

    // 모든 빈칸을 검사 (중앙부터 탐색하면 더 좋지만, 단순화함)
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === null) {
                // 이 자리에 백돌(AI)을 뒀을 때의 점수 (공격)
                const attackScore = evaluatePoint(board, x, y, 'white');
                // 이 자리에 흑돌(유저)을 뒀을 때의 점수 (수비 - 유저가 두면 아픈 곳)
                const defenseScore = evaluatePoint(board, x, y, 'black');
                
                // 공격과 수비 점수를 합산 (수비에 가중치를 약간 더 줌)
                let totalScore = attackScore + (defenseScore * 1.1);

                // 난이도 조절 (랜덤성 부여)
                if (difficulty === 'easy') totalScore *= Math.random(); // 하: 점수를 엉망으로 만듦
                if (difficulty === 'medium') totalScore *= (0.5 + Math.random() * 0.5); // 중: 약간의 실수

                if (totalScore > bestScore) {
                    bestScore = totalScore;
                    moves = [{ x, y }];
                } else if (totalScore === bestScore) {
                    moves.push({ x, y });
                }
            }
        }
    }

    // 최고의 수들 중 하나를 무작위 선택
    if (moves.length > 0) {
        const randomIdx = Math.floor(Math.random() * moves.length);
        return moves[randomIdx];
    }
    return { x: 9, y: 9 }; // 둘 곳 없으면 중앙
}

// 특정 좌표의 가치 평가
function evaluatePoint(board, x, y, color) {
    let score = 0;
    // 가로, 세로, 대각선, 역대각선 확인
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

    for (let [dx, dy] of directions) {
        let line = [];
        // 해당 좌표를 중심으로 양쪽 4칸씩 가져와서 패턴 분석
        for (let i = -4; i <= 4; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE) {
                if (i === 0) line.push(color); // 내 돌을 뒀다고 가정
                else line.push(board[ny][nx]);
            } else {
                line.push('wall'); // 벽
            }
        }
        score += evaluateLine(line, color);
    }
    return score;
}

// 라인 패턴 분석
function evaluateLine(line, color) {
    const str = line.map(c => c === color ? 'O' : (c === null ? '_' : 'X')).join('');
    
    if (str.includes('OOOOO')) return SCORES.WIN;
    if (str.includes('_OOOO_')) return SCORES.OPEN_4;
    if (str.includes('OOOO_') || str.includes('_OOOO')) return SCORES.CLOSED_4;
    if (str.includes('OO_OO')) return SCORES.CLOSED_4; // 징검다리 4
    if (str.includes('_OOO_')) return SCORES.OPEN_3;
    if (str.includes('OOO_') || str.includes('_OOO')) return SCORES.CLOSED_3;
    if (str.includes('_OO_')) return SCORES.OPEN_2;
    
    return 0;
}

module.exports = { getBestMove };
