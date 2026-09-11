const API_BASE = "";
const THEME_KEY = "todo-app.theme";

const form = document.getElementById("add-form");
const input = document.getElementById("task-input");
const deadlineInput = document.getElementById("deadline-input");
const priorityInput = document.getElementById("priority-input");
const categoryInput = document.getElementById("category-input");
const repeatInput = document.getElementById("repeat-input");
const openList = document.getElementById("open-list");
const completedList = document.getElementById("completed-list");
const clearDoneBtn = document.getElementById("clear-done-btn");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const categoryTabs = document.getElementById("category-tabs");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
const qrModal = document.getElementById("qr-modal");
const qrCloseBtn = document.getElementById("qr-close-btn");
const qrTaskText = document.getElementById("qr-task-text");
const qrCanvasWrap = document.getElementById("qr-canvas-wrap");
const qrLink = document.getElementById("qr-link");

let activeCategory = "all";
let tasks = [];

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem(THEME_KEY, theme);
}

applyTheme(localStorage.getItem(THEME_KEY) || "light");

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

async function fetchTasks() {
  const res = await fetch(`${API_BASE}/tasks`);
  tasks = await res.json();
  render();
}

async function addTask(text, priority, category, deadline, repeat) {
  await fetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, priority, category, deadline: deadline || null, repeat }),
  });
  await fetchTasks();
}

async function patchTask(id, patch) {
  await fetch(`${API_BASE}/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await fetchTasks();
}

async function deleteTask(id) {
  await fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE" });
  await fetchTasks();
}

async function toggleTask(id, done) {
  await patchTask(id, { done });
}

async function clearCompleted() {
  const done = tasks.filter((t) => t.done);
  await Promise.all(done.map((t) => fetch(`${API_BASE}/tasks/${t.id}`, { method: "DELETE" })));
  await fetchTasks();
}

function formatDeadline(deadline) {
  if (!deadline) return null;
  const dt = new Date(deadline);
  if (Number.isNaN(dt.getTime())) return null;
  const overdue = dt.getTime() < Date.now();
  return { text: dt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), overdue };
}

function openQrModal(task) {
  qrTaskText.textContent = task.text;
  qrCanvasWrap.innerHTML = "";
  const url = `${API_BASE}/complete/${task.id}`;
  new QRCode(qrCanvasWrap, { text: url, width: 180, height: 180 });
  qrLink.textContent = url;
  qrModal.hidden = false;
}

qrCloseBtn.addEventListener("click", () => {
  qrModal.hidden = true;
});

qrModal.addEventListener("click", (e) => {
  if (e.target === qrModal) qrModal.hidden = true;
});

function renderTask(task) {
  const li = document.createElement("li");
  li.className = "task-item" + (task.done ? " done" : "");
  li.draggable = !task.done;
  li.dataset.id = task.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.addEventListener("change", () => toggleTask(task.id, checkbox.checked));

  const textWrap = document.createElement("div");
  textWrap.className = "task-text-wrap";

  const span = document.createElement("span");
  span.className = "task-text";
  span.textContent = task.text;
  textWrap.appendChild(span);

  const deadlineInfo = formatDeadline(task.deadline);
  if (deadlineInfo) {
    const deadlineEl = document.createElement("span");
    deadlineEl.className = "deadline" + (deadlineInfo.overdue && !task.done ? " overdue" : "");
    deadlineEl.textContent = "⏰ " + deadlineInfo.text;
    textWrap.appendChild(deadlineEl);
  }

  if (task.completed_by) {
    const byEl = document.createElement("span");
    byEl.className = "completed-by";
    byEl.textContent = "✔ completed by " + task.completed_by;
    textWrap.appendChild(byEl);
  }

  const priorityBadge = document.createElement("span");
  priorityBadge.className = "priority-badge priority-" + task.priority;
  priorityBadge.textContent = task.priority;

  const categoryBadge = document.createElement("span");
  categoryBadge.className = "category-badge category-" + task.category;
  categoryBadge.textContent = task.category;

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "🐾";
  deleteBtn.setAttribute("aria-label", "Delete task");
  deleteBtn.addEventListener("click", () => deleteTask(task.id));

  const qrWrap = document.createElement("div");
  qrWrap.className = "qr-inline";
  qrWrap.title = "Scan to mark this task complete";
  qrWrap.addEventListener("click", () => openQrModal(task));

  li.append(checkbox, textWrap, categoryBadge, priorityBadge, qrWrap, deleteBtn);

  if (!task.done) {
    new QRCode(qrWrap, {
      text: `${API_BASE}/complete/${task.id}`,
      width: 40,
      height: 40,
      correctLevel: QRCode.CorrectLevel.L,
    });
  }

  return li;
}

function attachDragAndDrop() {
  let draggedId = null;

  openList.addEventListener("dragstart", (e) => {
    const li = e.target.closest(".task-item");
    if (!li) return;
    draggedId = li.dataset.id;
    e.dataTransfer.effectAllowed = "move";
  });

  openList.addEventListener("dragover", (e) => {
    e.preventDefault();
    const li = e.target.closest(".task-item");
    if (!li || li.dataset.id === draggedId) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    li.parentNode.insertBefore(
      openList.querySelector(`[data-id="${draggedId}"]`),
      before ? li : li.nextSibling
    );
  });

  openList.addEventListener("drop", async (e) => {
    e.preventDefault();
    const orderedIds = [...openList.querySelectorAll(".task-item")].map((el) => el.dataset.id);
    await Promise.all(
      orderedIds.map((id, index) =>
        fetch(`${API_BASE}/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: index }),
        })
      )
    );
    await fetchTasks();
  });
}

function render() {
  openList.innerHTML = "";
  completedList.innerHTML = "";
  const visible =
    activeCategory === "all" ? tasks : tasks.filter((t) => t.category === activeCategory);
  for (const task of visible) {
    const li = renderTask(task);
    (task.done ? completedList : openList).appendChild(li);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  await addTask(
    text,
    priorityInput.value,
    categoryInput.value,
    deadlineInput.value,
    repeatInput.value
  );
  input.value = "";
  deadlineInput.value = "";
  priorityInput.value = "medium";
  categoryInput.value = "personal";
  repeatInput.value = "none";
  input.focus();
});

clearDoneBtn.addEventListener("click", clearCompleted);

categoryTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".category-tab");
  if (!btn) return;
  activeCategory = btn.dataset.category;
  for (const tab of categoryTabs.querySelectorAll(".category-tab")) {
    tab.classList.toggle("active", tab === btn);
  }
  render();
});

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "todo-tasks.json";
  a.click();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert("Invalid JSON file.");
    return;
  }
  const payload = parsed.map((t) => ({
    text: t.text,
    priority: t.priority || "medium",
    category: t.category || "personal",
    deadline: t.deadline || null,
    repeat: t.repeat || "none",
  }));
  await fetch(`${API_BASE}/tasks/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  importFile.value = "";
  await fetchTasks();
});

attachDragAndDrop();
fetchTasks();
