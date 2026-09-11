import os
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta

import psycopg2
import psycopg2.extras
from flask import Flask, Response, jsonify, render_template, request

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), "..", "templates"),
    static_folder=os.path.join(os.path.dirname(__file__), "..", "static"),
)

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ["POSTGRES_URL"]


@contextmanager
def get_db():
    conn = psycopg2.connect(DATABASE_URL, sslmode="require")
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'medium',
                category TEXT NOT NULL DEFAULT 'personal',
                deadline TEXT,
                repeat TEXT NOT NULL DEFAULT 'none',
                done BOOLEAN NOT NULL DEFAULT FALSE,
                completed_by TEXT,
                position DOUBLE PRECISION NOT NULL DEFAULT 0
            )
            """
        )


init_db()


def row_to_task(row):
    return {
        "id": row["id"],
        "text": row["text"],
        "priority": row["priority"],
        "category": row["category"],
        "deadline": row["deadline"],
        "repeat": row["repeat"],
        "done": bool(row["done"]),
        "completed_by": row["completed_by"],
        "position": row["position"],
    }


def next_deadline(deadline, repeat):
    if not deadline or repeat == "none":
        return deadline
    try:
        dt = datetime.fromisoformat(deadline)
    except ValueError:
        return deadline
    if repeat == "daily":
        dt += timedelta(days=1)
    elif repeat == "weekly":
        dt += timedelta(weeks=1)
    return dt.isoformat()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/tasks", methods=["GET"])
def list_tasks():
    with get_db() as cur:
        cur.execute("SELECT * FROM tasks ORDER BY position ASC")
        rows = cur.fetchall()
    return jsonify([row_to_task(r) for r in rows])


@app.route("/tasks", methods=["POST"])
def create_task():
    body = request.get_json(force=True) or {}
    task_id = uuid.uuid4().hex
    with get_db() as cur:
        cur.execute("SELECT MAX(position) AS p FROM tasks")
        max_pos = cur.fetchone()["p"]
        position = (max_pos or 0) + 1
        cur.execute(
            """
            INSERT INTO tasks (id, text, priority, category, deadline, repeat, done, position)
            VALUES (%s, %s, %s, %s, %s, %s, FALSE, %s)
            """,
            (
                task_id,
                body.get("text", ""),
                body.get("priority", "medium"),
                body.get("category", "personal"),
                body.get("deadline"),
                body.get("repeat", "none"),
                position,
            ),
        )
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
    return jsonify(row_to_task(row))


@app.route("/tasks/<task_id>", methods=["PATCH"])
def update_task(task_id):
    updates = request.get_json(force=True) or {}
    with get_db() as cur:
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
        if row is None:
            return jsonify({"detail": "Task not found"}), 404

        was_done = bool(row["done"])
        become_done = updates.get("done", was_done)
        updates.pop("done", None)

        set_clauses = []
        values = []
        for key in ("text", "priority", "category", "deadline", "repeat", "position"):
            if key in updates:
                set_clauses.append(f"{key} = %s")
                values.append(updates[key])

        if become_done and not was_done and row["repeat"] != "none":
            set_clauses.append("done = FALSE")
            set_clauses.append("deadline = %s")
            values.append(next_deadline(row["deadline"], row["repeat"]))
            set_clauses.append("completed_by = NULL")
        else:
            set_clauses.append("done = %s")
            values.append(bool(become_done))

        values.append(task_id)
        cur.execute(f"UPDATE tasks SET {', '.join(set_clauses)} WHERE id = %s", values)
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
    return jsonify(row_to_task(row))


@app.route("/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    with get_db() as cur:
        cur.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
    return jsonify({"ok": True})


@app.route("/tasks/import", methods=["POST"])
def import_tasks():
    tasks = request.get_json(force=True) or []
    with get_db() as cur:
        cur.execute("DELETE FROM tasks")
        for i, task in enumerate(tasks):
            cur.execute(
                """
                INSERT INTO tasks (id, text, priority, category, deadline, repeat, done, position)
                VALUES (%s, %s, %s, %s, %s, %s, FALSE, %s)
                """,
                (
                    uuid.uuid4().hex,
                    task.get("text", ""),
                    task.get("priority", "medium"),
                    task.get("category", "personal"),
                    task.get("deadline"),
                    task.get("repeat", "none"),
                    i,
                ),
            )
        cur.execute("SELECT * FROM tasks ORDER BY position ASC")
        rows = cur.fetchall()
    return jsonify([row_to_task(r) for r in rows])


@app.route("/tasks/<task_id>/complete", methods=["POST"])
def complete_task(task_id):
    payload = request.get_json(silent=True) or {}
    with get_db() as cur:
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
        if row is None:
            return jsonify({"detail": "Task not found"}), 404
        if row["repeat"] != "none":
            cur.execute(
                "UPDATE tasks SET done = FALSE, deadline = %s, completed_by = NULL WHERE id = %s",
                (next_deadline(row["deadline"], row["repeat"]), task_id),
            )
        else:
            cur.execute(
                "UPDATE tasks SET done = TRUE, completed_by = %s WHERE id = %s",
                (payload.get("name") or None, task_id),
            )
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
    return jsonify(row_to_task(row))


@app.route("/complete/<task_id>")
def complete_page(task_id):
    with get_db() as cur:
        cur.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        row = cur.fetchone()
    if row is None:
        return Response("<h1>Task not found</h1>", status=404, mimetype="text/html")

    task_text = row["text"]
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Complete Task</title>
      <style>
        body {{ font-family: system-ui, sans-serif; max-width: 420px; margin: 48px auto; padding: 0 16px; }}
        h1 {{ font-size: 1.2rem; }}
        input {{ width: 100%; padding: 10px; margin: 12px 0; border: 1px solid #d0d5dd; border-radius: 6px; box-sizing: border-box; }}
        button {{ width: 100%; padding: 12px; border: none; border-radius: 6px; background: #2563eb; color: #fff; font-size: 1rem; cursor: pointer; }}
        #status {{ margin-top: 16px; font-weight: 600; }}
      </style>
    </head>
    <body>
      <h1>Mark this task complete?</h1>
      <p><strong>{task_text}</strong></p>
      <input type="text" id="name" placeholder="Your name (optional)">
      <button onclick="submitComplete()">I'm done - mark complete</button>
      <div id="status"></div>
      <script>
        async function submitComplete() {{
          const name = document.getElementById("name").value.trim();
          const res = await fetch(window.location.origin + "/tasks/{task_id}/complete", {{
            method: "POST",
            headers: {{ "Content-Type": "application/json" }},
            body: JSON.stringify({{ name: name || null }})
          }});
          if (res.ok) {{
            document.getElementById("status").textContent = "Thank you! Task marked complete.";
          }} else {{
            document.getElementById("status").textContent = "Something went wrong.";
          }}
        }}
      </script>
    </body>
    </html>
    """
    return Response(html, mimetype="text/html")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
