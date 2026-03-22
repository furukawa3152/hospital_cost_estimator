const SHEET_ID = "1APlCwT1rTWmfMpQ7RbdhJHZvW5nvnSf9V0qBYI8lErc";
const SHEET_GID = "1617111867";
const LABEL_SHEET_NAME = "Q_label";

const CONDITION_KEYS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];

const statusEl = document.getElementById("status");
const wizardEl = document.getElementById("wizard");
const resultEl = document.getElementById("result");
const questionTitleEl = document.getElementById("questionTitle");
const questionHelpEl = document.getElementById("questionHelp");
const optionsEl = document.getElementById("options");
const restartBtn = document.getElementById("restartBtn");

const monthlyCapEl = document.getElementById("monthlyCap");
const mealCostEl = document.getElementById("mealCost");
const totalCostEl = document.getElementById("totalCost");
const summaryListEl = document.getElementById("summaryList");
const resultNoteEl = document.getElementById("resultNote");
const remarkTextEl = document.getElementById("remarkText");

let rows = [];
let answers = {};
let steps = [];
let currentStep = 0;
let questionMeta = [];

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function setStatus(text, type = "loading") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function parseGvizResponse(rawText) {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("スプレッドシートの形式を解析できませんでした。");
  }
  return JSON.parse(rawText.slice(start, end + 1));
}

function cellValue(cells, index) {
  if (!cells[index] || cells[index].v === null || cells[index].v === undefined) {
    return "";
  }
  return String(cells[index].v).trim();
}

function numberCell(cells, index) {
  if (!cells[index] || cells[index].v === null || cells[index].v === undefined) {
    return 0;
  }
  return Number(cells[index].v) || 0;
}

function normalizeQuestionLabel(label, fallback, index) {
  const trimmed = (label || "").trim();
  if (!trimmed) return fallback;

  // Q1 / Q1: 質問文 / Q1 質問文 を優先表示。
  const m = trimmed.match(/^(Q\d+)\s*[:：]?\s*(.*)$/i);
  if (!m) return trimmed;
  const suffix = m[2].trim();
  if (suffix) return suffix;
  return m[1].toUpperCase();
}

async function loadQuestionLabelsFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(LABEL_SHEET_NAME)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return {};

  const raw = await res.text();
  const obj = parseGvizResponse(raw);
  const map = {};

  (obj.table.rows || []).forEach((r) => {
    const cells = r.c || [];
    const key = normalizeKey(cellValue(cells, 0));
    const label = cellValue(cells, 1);
    if (!key || !label) return;
    map[key] = label;
  });

  return map;
}

async function loadSheet() {
  setStatus("データを読み込んでいます...", "loading");
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${SHEET_GID}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`読み込みに失敗しました (${res.status})`);
  }

  const raw = await res.text();
  const obj = parseGvizResponse(raw);
  const labelMap = await loadQuestionLabelsFromSheet().catch(() => ({}));

  questionMeta = CONDITION_KEYS.map((key, index) => {
    const col = obj.table.cols?.[index];
    const fallback = `質問${index + 1}`;
    const mappedLabel = labelMap[normalizeKey(key)] || labelMap[normalizeKey(`A${index + 1}`)];
    return {
      key,
      label: mappedLabel || normalizeQuestionLabel(col?.label || "", fallback, index)
    };
  });

  rows = (obj.table.rows || []).map((r) => {
    const cells = r.c || [];
    return {
      a1: cellValue(cells, 0),
      a2: cellValue(cells, 1),
      a3: cellValue(cells, 2),
      a4: cellValue(cells, 3),
      a5: cellValue(cells, 4),
      a6: cellValue(cells, 5),
      a7: cellValue(cells, 6),
      monthlyCap: numberCell(cells, 7),
      mealCost: numberCell(cells, 8),
      remark: cellValue(cells, 10)
    };
  });

  if (!rows.length) {
    throw new Error("シートにデータが見つかりません。");
  }

  answers = {};
  currentStep = 0;
  rebuildSteps();
  renderCurrentStep();

  statusEl.classList.add("hidden");
  wizardEl.classList.remove("hidden");
}

function getFilteredRowsByAnswers(baseAnswers = answers) {
  return rows.filter((row) =>
    CONDITION_KEYS.every((key) => {
      const selected = baseAnswers[key];
      if (!selected) return true;
      return row[key] === selected;
    })
  );
}

function getOptionsForColumn(columnKey, filteredRows) {
  const values = filteredRows.map((row) => row[columnKey]).filter(Boolean);
  return [...new Set(values)];
}

function rebuildSteps() {
  const filtered = getFilteredRowsByAnswers(answers);
  steps = questionMeta.filter((q) => getOptionsForColumn(q.key, filtered).length > 0);

  if (currentStep >= steps.length) {
    currentStep = Math.max(steps.length - 1, 0);
  }
}

function clearAnswersAfter(stepIndex) {
  const currentKey = steps[stepIndex]?.key;
  const currentPos = CONDITION_KEYS.findIndex((key) => key === currentKey);
  if (currentPos === -1) return;

  for (let i = currentPos + 1; i < CONDITION_KEYS.length; i += 1) {
    delete answers[CONDITION_KEYS[i]];
  }
}

function goToNextOrResult() {
  if (currentStep < steps.length - 1) {
    currentStep += 1;
    renderCurrentStep();
    return;
  }
  renderResult(getFilteredRowsByAnswers(answers));
}

function renderCurrentStep() {
  const step = steps[currentStep];

  // 現在のステップより後ろの回答は一旦無視して、候補行を絞り込み直す
  const currentKey = step?.key;
  const currentPos = CONDITION_KEYS.findIndex((key) => key === currentKey);
  const baseAnswers = {};

  if (currentPos >= 0) {
    for (let i = 0; i <= currentPos; i += 1) {
      const key = CONDITION_KEYS[i];
      if (answers[key]) {
        baseAnswers[key] = answers[key];
      }
    }
  }

  const activeRows = getFilteredRowsByAnswers(baseAnswers);
  if (!activeRows.length) {
    setStatus("一致する条件が見つかりませんでした。はじめから選び直してください。", "error");
    statusEl.classList.remove("hidden");
    wizardEl.classList.add("hidden");
    resultEl.classList.add("hidden");
    return;
  }

  resultEl.classList.add("hidden");
  wizardEl.classList.remove("hidden");
  statusEl.classList.add("hidden");

  const options = getOptionsForColumn(step.key, activeRows);
  const selected = answers[step.key] || "";

  questionTitleEl.textContent = step.label;
  questionHelpEl.textContent = "";
  optionsEl.innerHTML = "";

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = opt;
    if (opt === selected) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", () => {
      answers[step.key] = opt;
      clearAnswersAfter(currentStep);
      rebuildSteps();
      goToNextOrResult();
    });
    optionsEl.appendChild(btn);
  });
}

function toJPY(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function renderResult(matchedRows) {
  const row = matchedRows[0];
  const total = row.monthlyCap + row.mealCost;

  monthlyCapEl.textContent = toJPY(row.monthlyCap);
  mealCostEl.textContent = toJPY(row.mealCost);
  totalCostEl.textContent = toJPY(total);
  remarkTextEl.textContent = row.remark ? `備考: ${row.remark}` : "";

  summaryListEl.innerHTML = "";
  questionMeta.forEach((q) => {
    if (!answers[q.key]) return;
    const li = document.createElement("li");
    li.textContent = `${q.label}: ${answers[q.key]}`;
    summaryListEl.appendChild(li);
  });

  if (matchedRows.length > 1) {
    resultNoteEl.textContent = `一致データが${matchedRows.length}件あります。先頭データを表示しています。`;
  } else {
    resultNoteEl.textContent = "上記金額はあくまで概算です。詳細な料金は、病態、手術内容等によって変動します。";
  }

  wizardEl.classList.add("hidden");
  resultEl.classList.remove("hidden");
}

restartBtn.addEventListener("click", () => {
  answers = {};
  currentStep = 0;
  statusEl.classList.add("hidden");
  resultEl.classList.add("hidden");
  rebuildSteps();
  renderCurrentStep();
});

loadSheet().catch((err) => {
  console.error(err);
  setStatus(
    "データ読込に失敗しました。シートの公開設定を確認してください（リンクを知っている全員が閲覧可）。",
    "error"
  );
});
