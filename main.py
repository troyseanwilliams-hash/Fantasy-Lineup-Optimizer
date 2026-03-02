from flask import Flask, request
import os

app = Flask(__name__)

@app.route("/write", methods=["POST"])
def write_file():
    if request.headers.get("X-Write-Key") != os.environ["DFS_BIZ_SECRET_KEY_666321456"]:
        return {"error": "unauthorized"}, 401

    data = request.json
    path = data.get("path")
    content = data.get("content")

    os.makedirs(os.path.dirname(path), exist_ok=True)

    with open(path, "w") as f:
        f.write(content)

    return {"status": "ok", "path": path}

app.run(host="0.0.0.0", port=8080)