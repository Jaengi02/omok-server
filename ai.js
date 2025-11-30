// ai.js
// Google Gemini API를 활용한 오목 AI

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ▼▼▼ 아까 발급받은 API 키를 여기에 넣으세요! ▼▼▼
const API_KEY = "AIzaSyB2EheSFXF4oxXcV5-YFK5DEVCba47pmNw";

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 오목 규칙: 흑(1), 백(2), 빈칸(null)
const BOARD_SIZE = 19;

async function getBestMove(board, difficulty) {
    try {
        // 1. 바둑판 상태를 문자열로 변환 (AI가 읽기 쉽게)
        // 예: "0,0,1,0,2..." 형태의 텍스트로 변환
        const boardString = board.map(row => 
            row.map(cell => cell === 'black' ? 'B' : (cell === 'white' ? 'W' : '.')).join('')
        ).join('\n');

        // 2. AI에게 보낼 프롬프트 (명령어) 작성
        const prompt = `
        You are an expert Gomoku (Renju) AI player.
        You are playing White (W). The opponent is Black (B).
        Current board state (19x19 grid, . is empty, B is black, W is white):
        
        ${boardString}

        Task: Analyze the board and provide the best next move coordinates for White (W) to win or block Black.
        Rules:
        1. Coordinates must be x (0-18) and y (0-18).
        2. Do not place on top of existing stones (B or W).
        3. Prioritize blocking opponent's winning lines (3 or 4 in a row).
        
        Output Format: JSON only. Example: {"x": 9, "y": 9}
        Respond ONLY with the JSON.
        `;

        // 3. Gemini에게 질문
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 4. 응답에서 좌표 추출 (JSON 파싱)
        // AI가 가끔 설명글을 붙일 수 있으므로 JSON 부분만 찾음
        const jsonMatch = text.match(/\{.*"x".*?,"y".*?\}/s);
        
        if (jsonMatch) {
            const move = JSON.parse(jsonMatch[0]);
            // 유효성 검사 (범위 내에 있고 빈칸인지)
            if (isValidMove(board, move.x, move.y)) {
                console.log(`🤖 Gemini AI Move: (${move.x}, ${move.y})`);
                return move;
            }
        }

        throw new Error("AI gave invalid move");

    } catch (error) {
        console.error("❌ Gemini API Error (Fallback to random):", error.message);
        // AI가 실패하거나 너무 느리면 방어적인 랜덤 수를 둠
        return getFallbackMove(board);
    }
}

// 유효성 검사
function isValidMove(board, x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE && board[y][x] === null;
}

// 비상용 (AI 에러 시) - 돌 주변에 두는 로직
function getFallbackMove(board) {
    const candidates = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === null) {
                // 주변에 돌이 있는 곳만 후보로 (완전 랜덤 방지)
                if (hasNeighbor(board, x, y)) candidates.push({ x, y });
            }
        }
    }
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
    return { x: 9, y: 9 };
}

function hasNeighbor(board, x, y) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && board[ny][nx] !== null) {
                return true;
            }
        }
    }
    return false;
}

module.exports = { getBestMove };
