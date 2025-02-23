import { serve } from "https://deno.land/std@0.200.0/http/server.ts";

// 辅助函数：将数字转换为可变长度整数（VarInt）
function writeVarInt(value: number): Uint8Array {
    const buffer = new Uint8Array(5);
    let index = 0;
    do {
        let temp = value & 0x7F;
        value >>>= 7;
        if (value!== 0) {
            temp |= 0x80;
        }
        buffer[index++] = temp;
    } while (value!== 0);
    return buffer.slice(0, index);
}

// 辅助函数：读取可变长度整数（VarInt）
function readVarInt(buffer: Uint8Array, offset: number): [number, number] {
    let value = 0;
    let numRead = 0;
    let read;
    do {
        read = buffer[offset + numRead];
        value |= (read & 0x7F) << (7 * numRead);
        numRead++;
        if (numRead > 5) {
            throw new Error('VarInt is too big');
        }
    } while ((read & 0x80) === 0x80);
    return [value, numRead];
}

// 检查服务器状态的函数
async function checkServerStatus(address: string): Promise<any> {
    const [host, portStr] = address.split(':');
    const port = portStr? parseInt(portStr, 10) : 25565;

    try {
        const conn = await Deno.connect({ hostname: host, port });
        try {
            // 发送握手包
            const handshakePacket = new Uint8Array([
               ...writeVarInt(0), // Packet ID
               ...writeVarInt(-1), // Protocol version
               ...writeVarInt(host.length), // Host length
               ...new TextEncoder().encode(host), // Host
               ...new Uint8Array([port >> 8, port & 0xFF]), // Port
               ...writeVarInt(1) // Next state (status)
            ]);
            const handshakeLength = writeVarInt(handshakePacket.length);
            await conn.write(new Uint8Array([...handshakeLength,...handshakePacket]));

            // 发送状态请求包
            const statusRequestPacket = new Uint8Array([0]);
            const statusRequestLength = writeVarInt(statusRequestPacket.length);
            await conn.write(new Uint8Array([...statusRequestLength,...statusRequestPacket]));

            // 读取响应
            const buffer = new Uint8Array(4096);
            const n = await conn.read(buffer);
            if (n === null) {
                throw new Error('No data received');
            }
            const responseBuffer = buffer.subarray(0, n);
            const [packetLength, lengthRead] = readVarInt(responseBuffer, 0);
            const [packetId, idRead] = readVarInt(responseBuffer, lengthRead);
            if (packetId!== 0) {
                throw new Error('Unexpected packet ID');
            }
            const jsonLength = readVarInt(responseBuffer, lengthRead + idRead)[0];
            const jsonStart = lengthRead + idRead + readVarInt(responseBuffer, lengthRead + idRead)[1];
            const jsonData = new TextDecoder().decode(responseBuffer.subarray(jsonStart, jsonStart + jsonLength));
            const status = JSON.parse(jsonData);

            return {
                max_players: status.players.max,
                online_players: status.players.online,
                description: status.description
            };
        } finally {
            conn.close();
        }
    } catch (error) {
        return { error: error.message };
    }
}

const handler = async (req: Request): Promise<Response> => {
    // 允许跨域的头信息
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    if (req.method === "GET" && req.url.includes("/")) {
        const url = new URL(req.url);
        const addresses = url.searchParams.get("address");

        if (!addresses) {
            return new Response(JSON.stringify({ error: "No addresses provided" }), {
                status: 400,
                headers
            });
        }

        const servers = addresses.split(",");
        const statusPromises = servers.map(checkServerStatus);
        const resultsArray = await Promise.all(statusPromises);

        const results: { [key: string]: any } = {};
        servers.forEach((serverAddress, index) => {
            results[serverAddress] = resultsArray[index];
        });

        return new Response(JSON.stringify(results), {
            headers
        });
    }

    return new Response("Not Found", { status: 404, headers });
};

serve(handler, { port: 8000 });