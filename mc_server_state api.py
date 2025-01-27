from flask import Flask, request, jsonify
from mcstatus import JavaServer
from flask_cors import CORS
import socket

app = Flask(__name__)
CORS(app)

@app.route('/check_servers', methods=['GET'])
def check_servers():
    addresses = request.args.get('address')
    if not addresses:
        return jsonify({"error": "No addresses provided"}), 400

    servers = addresses.split(',')
    results = {}

    for server_address in servers:
        try:
            server = JavaServer.lookup(server_address)
            # 创建一个自定义的 socket 并设置超时时间
            original_socket = socket.socket
            def custom_socket(*args, **kwargs):
                s = original_socket(*args, **kwargs)
                s.settimeout(10)  # 设置超时时间为 10 秒
                return s
            socket.socket = custom_socket

            status = server.status()
            results[server_address] = {
                "max_players": status.players.max,
                "online_players": status.players.online,
                "description": status.description
            }
        except Exception as e:
            results[server_address] = {
                "error": str(e)
            }
        finally:
            # 恢复原始的 socket 函数
            socket.socket = original_socket

    return jsonify(results)

if __name__ == '__main__':
    app.run(debug=True)