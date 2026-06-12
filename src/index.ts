import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "colyseus";
import { CarRoom } from "./rooms/CarRoom";

const port = Number(process.env.PORT) || 2567;
const app = express();

app.use(cors());
app.use(express.json());

app.get("/test", (req, res) => {
    res.json({ message: "0.15 伺服器運作中" });
});

const server = http.createServer(app);

// 0.15 版的寫法：直接把 server 傳入，不需要 WebSocketTransport 物件
const gameServer = new Server({
    server: server
});

// 定義房間
gameServer.define("car_room", CarRoom);

server.listen(port, () => {
    console.log(`=========================================`);
    console.log(`✅ 同學推薦的 0.15 伺服器啟動成功！`);
    console.log(`🔹 端口: ${port}`);
    console.log(`=========================================`);
});