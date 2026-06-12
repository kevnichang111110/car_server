import { Room, Client } from "colyseus";

interface PlayerInfo {
    sessionId: string;
    seat: "P1" | "P2";
    ready: boolean;
    grid: any[];
    name: string;
}

type WinnerSeat = "P1" | "P2";

export class CarRoom extends Room {
    maxClients = 2;

    private players = new Map<string, PlayerInfo>();
    private scores = { P1: 0, P2: 0 };
    private round = 1;

    private battleStarted = false;
    private suddenDeathStarted = false;
    private roundLocked = false;

    private seed = 0;
    private mapIndex = 0;

    onCreate(options: any) {
        console.log("🏠 戰車房間 [car_room] 建立成功");

        this.onMessage("sync", (client, data) => {
            this.broadcast("sync", data, { except: client });
        });

        this.onMessage("ready", (client, message) => {
            const p = this.players.get(client.sessionId);
            if (!p) return;

            if (p.ready) {
                client.send("ready_rejected", { reason: "你已經 ready 了" });
                return;
            }

            p.ready = true;
            p.grid = message.grid || [];
            console.log(`✅ [${p.seat}] ${client.sessionId} 已準備，零件數: ${p.grid.length}`);

            this.broadcast("ready_status", {
                p1Ready: this.getPlayer("P1")?.ready || false,
                p2Ready: this.getPlayer("P2")?.ready || false,
            });

            this.checkAllReady();
        });

        this.onMessage("input", (client, input) => {
            const p = this.players.get(client.sessionId);
            if (!p) return;

            this.broadcast("input", { seat: p.seat, input }, { except: client });
        });

        this.onMessage("startSuddenDeath", (_client) => {
            if (this.suddenDeathStarted) return;
            this.suddenDeathStarted = true;
            this.broadcast("startSuddenDeath", { round: this.round });
        });

        // Server CarRoom.ts
        this.onMessage("roundOver", (client, message) => {
            const p = this.players.get(client.sessionId);
            // 只有主機 P1 有權回報勝負
            if (p && p.seat === "P1") {
                const winner = message.winner; // "P1" 或 "P2"
                console.log(`>>> [Step 2] 伺服器收到主機回報，廣播 round_result 給所有人`);
                
                // 增加分數
                if (winner === "P1") this.scores.P1++;
                else if (winner === "P2") this.scores.P2++;

                console.log(`🏆 回合結束！贏家: ${winner} | 目前比數: P1 ${this.scores.P1} - P2 ${this.scores.P2}`);

                // 三戰兩勝判定
                const matchOver = this.scores.P1 >= 3 || this.scores.P2 >= 3;

                // 【關鍵】將更新後的分數廣播給所有玩家
                this.broadcast("round_result", {
                    winner: winner,
                    scores: this.scores,
                    matchOver: matchOver
                });
                this.battleStarted = false; 
                this.suddenDeathStarted = false;
                this.roundLocked = false;
                this.round += 1; // 回合數增加

                
                console.log(`✅ 回合狀態已重置，準備進入第 ${this.round} 回合`);
                
                // 重置所有人的準備狀態，準備下一局
                this.players.forEach(player => player.ready = false);
            }
        });
    }

    onJoin(client: Client, options: any) {
        const seat: "P1" | "P2" = this.clients.length === 1 ? "P1" : "P2";
        const playerName = options.name || (seat === "P1" ? "Player 1" : "Player 2");
        this.players.set(client.sessionId, {
            sessionId: client.sessionId,
            seat,
            ready: false,
            grid: [],
            name: playerName
        });

        console.log(`👤 玩家加入: ${client.sessionId} 分配到 ${seat}`);

        client.send("joined", {
            seat,
            roomId: this.roomId,
            round: this.round,
            scores: this.scores,
            name: playerName
        });

        if (this.clients.length === 2) {
            const p1 = this.getPlayer("P1");
            const p2 = this.getPlayer("P2");
            this.broadcast("matched", {
                status: "ready",
                roomId: this.roomId,
                round: this.round,
                scores: this.scores,
                p1Name: p1?.name || "P1", // 傳送 P1 名字
                p2Name: p2?.name || "P2"  // 傳送 P2 名字
            });
        }
    }

    private checkAllReady() {
        const playersArray = Array.from(this.players.values());
        const everyoneReady = playersArray.length === 2 && playersArray.every(p => p.ready);

        if (!everyoneReady || this.battleStarted) {
            console.log(`⌛ 等待中... 目前準備進度: ${playersArray.filter(p => p.ready).length}/2`);
            return;
        }

        this.battleStarted = true;
        this.suddenDeathStarted = false;
        this.roundLocked = false;

        // 每局都重新選一組 seed / mapIndex，兩邊會拿到同一組
        this.seed = Math.floor(Math.random() * 99999999);
        this.mapIndex = Math.floor(Math.random() * 99999999);

        console.log("🚀 全員準備完成！發送 battle_start 廣播");

        const p1 = playersArray.find(x => x.seat === "P1");
        const p2 = playersArray.find(x => x.seat === "P2");

        this.broadcast("battle_start", {
            p1Grid: p1?.grid || [],
            p2Grid: p2?.grid || [],
            seed: this.seed,
            mapIndex: this.mapIndex,
            round: this.round,
            scores: this.scores
        });
    }

    private handleRoundOver(winner: WinnerSeat) {
        if (this.roundLocked) return;
        this.roundLocked = true;

        this.scores[winner] += 1;
        const matchOver = this.scores[winner] >= 4;

        this.broadcast("round_result", {
            winner,
            matchOver,
            round: this.round,
            scores: this.scores
        });

        if (matchOver) {
            console.log(`🏆 比賽結束，${winner} 勝利`);
            return;
        }

        // 下一回合準備
        this.round += 1;
        this.battleStarted = false;
        this.suddenDeathStarted = false;

        for (const p of this.players.values()) {
            p.ready = false;
        }

        this.broadcast("ready_status", {
            p1Ready: false,
            p2Ready: false
        });
    }

    private getPlayer(seat: "P1" | "P2") {
        return Array.from(this.players.values()).find(p => p.seat === seat);
    }

    onLeave(client: Client, _consented: boolean) {
        console.log(`👋 玩家離開: ${client.sessionId}`);
        this.players.delete(client.sessionId);
        this.broadcast("opponent_left");

        this.battleStarted = false;
        this.suddenDeathStarted = false;
        this.roundLocked = false;
    }
}