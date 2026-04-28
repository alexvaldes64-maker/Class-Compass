import {
  answerGroundedQuestion,
  buildFlashcards,
  buildStudyGuide,
  decodeAssignment,
  generateQuiz,
} from "./assistant.js";
import {
  addTasks,
  addSubtasks,
  completeTask,
  confirmDraftImport,
  ensureProfile,
  getSession,
  loadChatMessages,
  loadWorkspace,
  saveChatMessage,
  saveDecoderRun,
  saveDraftReview,
  saveProfile,
  signInAnonymously,
  toggleTask,
  updateTask,
  uploadAndCreateDrafts,
  clearLocalWorkspace,
} from "./data.js";
import { parseCourseFiles } from "./parser.js";
import { buildPlannerSnapshot, buildWeeklyReset, semesterWeeks } from "./planner.js";
import { addDays, escapeHtml, formatLong, isoDay, monthMatrix, uid } from "./utils.js";

const routes = ["today", "courses", "calendar", "assignments", "study", "upload", "settings"];
const uploadSteps = [
  "Reading file",
  "Finding course details",
  "Finding deadlines",
  "Finding grading weights",
  "Preparing review",
];
const root = document.getElementById("app");

const state = {
  session: null,
  user: null,
  profile: null,
  courses: [],
  documents: [],
  draftImports: [],
  assignments: [],
  exams: [],
  readings: [],
  tasks: [],
  weeklyReset: null,
  decoder: null,
  chatMessages: [],
  ui: {
    route: "today",
    selectedCourseId: "",
    selectedAssignmentId: "",
    selectedDraftId: "",
    studyMode: "guide",
    uploadStage: "",
    status: "",
    error: "",
    sourceDrawer: null,
    reviewTab: "flagged",
    selectedReviewItemId: "",
    selectedReviewItemType: "",
    activeCourseTab: "overview",
    activeWeekId: "",
    focusTaskId: "",
    stepsTaskId: "",
    toastId: "",
    completedCollapsed: true,
    starting: true,
  },
};

init();

async function init() {
  window.addEventListener("hashchange", () => {
    state.ui.route = resolveRoute();
    render();
  });
  state.ui.route = resolveRoute();

  try {
    let session = await getSession();
    if (!session?.user) {
      session = await signInAnonymously();
    }
    if (session?.user) {
      state.session = session;
      state.user = session.user;
      await hydrateWorkspace();
    }
  } catch (error) {
    state.ui.error = friendlyStartupError(error);
  } finally {
    state.ui.starting = false;
    render();
  }
}

function friendlyStartupError(error) {
  return error?.message || "Class Compass could not start. Refresh and try again.";
}

function resolveRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return routes.includes(hash) ? hash : "today";
}

async function hydrateWorkspace() {
  await ensureProfile(state.user);
  const workspace = await loadWorkspace(state.user);
  state.profile = workspace.profile;
  state.courses = workspace.courses;
  state.documents = workspace.documents;
  state.draftImports = workspace.draftImports;
  state.assignments = workspace.assignments;
  state.exams = workspace.exams;
  state.readings = workspace.readings;
  state.tasks = workspace.tasks;
  state.weeklyReset = workspace.weeklyReset;
  state.decoder = workspace.decoder?.result || null;
  syncSelections();
  state.chatMessages = await loadChatMessages(state.user.id, state.ui.selectedCourseId || null);
}

function clearWorkspace() {
  state.profile = null;
  state.courses = [];
  state.documents = [];
  state.draftImports = [];
  state.assignments = [];
  state.exams = [];
  state.readings = [];
  state.tasks = [];
  state.weeklyReset = null;
  state.decoder = null;
  state.chatMessages = [];
  state.ui.selectedCourseId = "";
  state.ui.selectedAssignmentId = "";
  state.ui.selectedDraftId = "";
}

function clearStatus() {
  state.ui.status = "";
  state.ui.error = "";
  state.ui.toastId = "";
}

function showToast(message, type = "status") {
  if (type === "error") state.ui.error = message;
  else state.ui.status = message;
  state.ui.toastId = uid("toast");
}

function syncSelections() {
  if (!state.courses.some((course) => course.id === state.ui.selectedCourseId)) {
    state.ui.selectedCourseId = state.courses[0]?.id || "";
  }
  if (!state.assignments.some((assignment) => assignment.id === state.ui.selectedAssignmentId)) {
    state.ui.selectedAssignmentId = state.assignments[0]?.id || "";
  }
  if (!state.draftImports.some((draft) => draft.id === state.ui.selectedDraftId)) {
    state.ui.selectedDraftId = state.draftImports[0]?.id || "";
  }
}

function setupStep() {
  if (state.ui.starting) return "starting";
  if (!state.session) return "blocked";
  if (state.draftImports.length) return "review";
  if (!state.courses.length) return "upload";
  return "ready";
}

function plannerSnapshot() {
  return buildPlannerSnapshot({
    assignments: state.assignments,
    exams: state.exams,
    tasks: state.tasks,
    courses: state.courses,
  });
}

function selectedCourse() {
  return state.courses.find((course) => course.id === state.ui.selectedCourseId) || state.courses[0] || null;
}

function selectedAssignment() {
  return state.assignments.find((assignment) => assignment.id === state.ui.selectedAssignmentId) || state.assignments[0] || null;
}

function selectedDraft() {
  return state.draftImports.find((draft) => draft.id === state.ui.selectedDraftId) || state.draftImports[0] || null;
}

function render() {
  const step = setupStep();
  if (step === "starting") {
    root.innerHTML = renderShell("Getting Class Compass ready", renderStarting());
    bindEvents();
    return;
  }
  if (step === "blocked") {
    root.innerHTML = renderShell("Setup needed", renderBlocked());
    bindEvents();
    return;
  }
  if (step === "upload") {
    root.innerHTML = renderFirstRunFrame(renderFirstRunUpload());
    bindEvents();
    return;
  }
  if (step === "review") {
    root.innerHTML = renderFirstRunFrame(renderImportReview());
    bindEvents();
    return;
  }

  const views = {
    today: renderToday(),
    courses: renderCourseCommandCenter(),
    calendar: renderSemesterMap(),
    assignments: renderAssignmentDecoder(),
    study: renderStudyMode(),
    upload: renderUpload(),
    settings: renderSettings(),
  };

  root.innerHTML = renderShell(pageTitle(), views[state.ui.route]);
  bindEvents();
}

function renderShell(title, view) {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-block">
          <div class="brand-mark">CC</div>
          <div>
            <p class="eyebrow">Class Compass</p>
            <h1>${escapeHtml(state.profile?.term || "Current term")}</h1>
          </div>
        </div>
        <nav class="nav">
          ${routes.map((route) => `<button class="${state.ui.route === route ? "active" : ""}" data-route="${route}">${navIcon(route)}<span>${label(route)}</span></button>`).join("")}
        </nav>
        <button class="sidebar-add" data-action="go-upload">${navIcon("upload")} Add file</button>
        ${
          state.courses.length
            ? `<div class="sidebar-courses"><p class="sidebar-label">Courses</p>${state.courses
                .map(
                  (course) =>
                    `<button class="${state.ui.selectedCourseId === course.id ? "active" : ""}" data-select-course="${course.id}"><span class="course-dot" style="background:${escapeHtml(course.color || "#2563eb")}"></span>${escapeHtml(course.code || "Course")}</button>`
                )
                .join("")}</div>`
            : ""
        }
      </aside>
      <main class="main-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">${label(state.ui.route)}</p>
            <h2>${escapeHtml(title)}</h2>
          </div>
          <div class="topbar-actions">
            <label class="command-search">${navIcon("search")}<input placeholder="Search tasks, deadlines, sources..." /><kbd>Ctrl K</kbd></label>
            <button class="secondary-button" data-action="go-upload">${navIcon("upload")} Add file</button>
            <span class="profile-pill">${escapeHtml(state.profile?.first_name || "Student")}</span>
          </div>
        </header>
        ${view}
      </main>
      ${renderToast()}
      ${renderSourceDrawer()}
      ${renderFocusSessionModal()}
      ${renderBreakIntoStepsDrawer()}
      ${renderWeekDetailDrawer()}
    </div>
  `;
}

function renderFirstRunFrame(view) {
  const reviewing = setupStep() === "review";
  const draft = selectedDraft();
  return `
    <main class="first-run-shell ${reviewing ? "review-mode" : ""}">
      <section class="first-run-header">
        <div class="brand-block">
          <div class="brand-mark">CC</div>
          <div>
            <p class="eyebrow">Class Compass</p>
            <h1>${reviewing ? `Review ${escapeHtml(draft?.course_draft?.code || "course")} import` : "Upload your syllabus. Get your semester plan."}</h1>
            ${reviewing ? `<p class="body-copy">Approve what Class Compass found before it enters your plan.</p>` : ""}
          </div>
        </div>
        <div class="setup-steps">
          <span class="step-chip active">1 Upload</span>
          <span class="step-chip ${state.draftImports.length ? "active" : ""}">2 Review</span>
          <span class="step-chip ${state.courses.length ? "active" : ""}">3 Today</span>
        </div>
      </section>
      ${view}
      ${renderToast()}
      ${renderSourceDrawer()}
      ${renderFocusSessionModal()}
      ${renderBreakIntoStepsDrawer()}
      ${renderWeekDetailDrawer()}
    </main>
  `;
}

function renderToast() {
  if (!state.ui.status && !state.ui.error) return "";
  const toastId = state.ui.toastId || uid("toast");
  state.ui.toastId = toastId;
  window.setTimeout(() => {
    if (state.ui.toastId === toastId) {
      clearStatus();
      render();
    }
  }, 3000);
  return `<div class="toast-stack">
    ${state.ui.status ? `<div class="toast">${escapeHtml(state.ui.status)}</div>` : ""}
    ${state.ui.error ? `<div class="toast danger">${escapeHtml(state.ui.error)}</div>` : ""}
  </div>`;
}

function renderSourceDrawer() {
  if (!state.ui.sourceDrawer) return "";
  return `
    <div class="drawer-backdrop" data-action="close-source"></div>
    <aside class="source-drawer">
      <button class="ghost-button drawer-close" data-action="close-source">Close</button>
      <p class="eyebrow">Source excerpt</p>
      <h3>${escapeHtml(state.ui.sourceDrawer.title || "Uploaded material")}</h3>
      <p class="source-excerpt">${escapeHtml(state.ui.sourceDrawer.excerpt || "No excerpt available.")}</p>
      <div class="button-row top-space"><button class="secondary-button" data-action="close-source">Use this source</button><button class="ghost-button" data-action="close-source">Mark incorrect</button></div>
    </aside>
  `;
}

function renderFocusSessionModal() {
  const task = state.tasks.find((item) => item.id === state.ui.focusTaskId);
  if (!task) return "";
  const source = sourceForTask(task);
  return `
    <div class="drawer-backdrop" data-action="close-focus"></div>
    <section class="focus-modal">
      <p class="eyebrow">Focus session</p>
      <h3>${escapeHtml(task.title)}</h3>
      <div class="timer-placeholder">25:00</div>
      <div class="focus-steps">${taskSteps(task).map((step) => `<span>${escapeHtml(step)}</span>`).join("")}</div>
      ${source ? `<button class="source-button" data-source-title="${escapeHtml(source.title)}" data-source-excerpt="${escapeHtml(source.excerpt)}">Open source</button>` : `<p class="minimal-note">No matching source attached.</p>`}
      <div class="button-row"><button class="primary-button" data-action="complete-focus" data-task-id="${task.id}">Mark done</button><button class="secondary-button" data-action="close-focus">Pause</button><button class="ghost-button" data-action="close-focus">Cancel</button></div>
    </section>
  `;
}

function renderBreakIntoStepsDrawer() {
  const task = state.tasks.find((item) => item.id === state.ui.stepsTaskId);
  if (!task) return "";
  const steps = taskSteps(task);
  return `
    <div class="drawer-backdrop" data-action="close-steps"></div>
    <aside class="source-drawer">
      <button class="ghost-button drawer-close" data-action="close-steps">Close</button>
      <p class="eyebrow">Break into steps</p>
      <h3>${escapeHtml(task.title)}</h3>
      <div class="step-list">${steps.map((step) => `<label><input type="checkbox" checked /> ${escapeHtml(step)}</label>`).join("")}</div>
      <div class="button-row top-space"><button class="primary-button" data-action="add-subtasks" data-task-id="${task.id}">Add to Today Queue</button><button class="secondary-button" data-action="close-steps">Cancel</button></div>
    </aside>
  `;
}

function renderWeekDetailDrawer() {
  if (!state.ui.activeWeekId) return "";
  const week = semesterWeeks({ assignments: state.assignments, exams: state.exams, readings: state.readings }).find((item) => item.start === state.ui.activeWeekId);
  if (!week) return "";
  return `
    <div class="drawer-backdrop" data-action="close-week"></div>
    <aside class="source-drawer">
      <button class="ghost-button drawer-close" data-action="close-week">Close</button>
      <p class="eyebrow">${escapeHtml(week.levelLabel)}</p>
      <h3>${escapeHtml(week.label)}</h3>
      <div class="quiet-list">${week.items.map((item) => `<div class="settings-row"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.date ? formatLong(item.date) : "")}</span></div>`).join("")}</div>
    </aside>
  `;
}

function renderStarting() {
  return `<section class="full-panel"><div class="empty-state"><h3>Opening your workspace</h3><p class="empty-copy">Class Compass is getting a private workspace ready for this device.</p></div></section>`;
}

function renderBlocked() {
  return `<section class="full-panel"><div class="empty-state"><h3>Class Compass could not open</h3><p class="empty-copy">${escapeHtml(state.ui.error || "Refresh and try again.")}</p></div></section>`;
}

function renderFirstRunUpload() {
  return `
    <section class="first-run-grid">
      <article class="focus-panel">
        <p class="eyebrow">Step 1</p>
        <h2>Upload your first syllabus.</h2>
        <p class="body-copy">We pull out deadlines, exams, readings, grading weights, and policies. You approve everything before it enters your plan.</p>
        ${renderUploadForm("Build my semester plan")}
        <button class="link-button top-space" data-action="sample-syllabus">No file yet? Try a sample semester.</button>
      </article>
      <aside class="preview-panel">
        <div class="mini-window">
          <div class="mini-topbar"><span></span><span></span><span></span></div>
          <p class="eyebrow">Today preview</p>
          <h3>3 actions found</h3>
          <div class="preview-action"><strong>Start Lab Report 1</strong><span>Due soon · BIO 142 · 35 min</span></div>
          <div class="preview-action"><strong>Review cell transport</strong><span>Quiz in 7 days · study block</span></div>
          <div class="preview-risk">Heavy week ahead: midterm + project milestone</div>
        </div>
        <div class="preview-cards">
          <div><strong>Today plan</strong><span>Know what to do next.</span></div>
          <div><strong>Risk weeks</strong><span>Spot deadline clusters early.</span></div>
          <div><strong>Study tools</strong><span>Quiz from your own files.</span></div>
        </div>
      </aside>
    </section>
  `;
}

function renderUploadForm(buttonText = "Build my class plan") {
  return `
    <form id="upload-form" class="form-grid top-space">
      <label class="upload-dropzone">
        <input name="files" type="file" accept=".pdf,.txt,.md,.csv" multiple required />
        <span class="drop-icon">${navIcon("upload")}</span>
        <strong>Drop your syllabus here</strong>
        <p class="hint">PDF, TXT, Markdown, prompts, rubrics, and notes. Text-readable PDFs work best.</p>
        <span class="secondary-button">Choose file</span>
      </label>
      ${renderUploadProgress()}
      <button class="primary-button" type="submit">${escapeHtml(buttonText)}</button>
    </form>
  `;
}

function renderUploadProgress() {
  if (!state.ui.uploadStage) return "";
  return `
    <div class="progress-list">
      ${uploadSteps
        .map((step) => {
          const active = uploadSteps.indexOf(step) <= uploadSteps.indexOf(state.ui.uploadStage);
          return `<span class="progress-step ${active ? "active" : ""}">${escapeHtml(step)}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderImportReview() {
  const draft = selectedDraft();
  if (!draft) return renderFirstRunUpload();
  applyReviewDefaults(draft);
  return `
    <section class="import-review-shell">
      <article class="review-workspace">
        ${renderReviewSummaryHeader(draft)}
        ${renderReviewTabs(draft)}
        ${renderReviewTable(draft)}
      </article>
      ${renderReviewSidePanel(draft)}
      ${renderStickyReviewBar(draft)}
    </section>
  `;
  const confidence = draftConfidence(draft);
  return `
    <section class="review-layout">
      <article class="focus-panel">
        <div class="review-cockpit-header">
          <div>
            <p class="eyebrow">Step 2 · Review import</p>
            <h2>${escapeHtml(draft.course_draft?.code || "Course")} · ${escapeHtml(draft.course_draft?.title || "Untitled course")}</h2>
            <p class="body-copy">Edit anything that looks off. Approved items are the only things that enter your semester plan.</p>
          </div>
          <div class="confidence-meter"><strong>${confidence}%</strong><span>confidence</span></div>
        </div>
        ${renderDraftEditor(draft)}
      </article>
      <aside class="side-panel sticky-panel">
        <h3>Needs your review</h3>
        <div class="quiet-list">
          ${state.draftImports
            .map((item) => `<button class="review-picker ${item.id === draft.id ? "active" : ""}" data-open-draft="${item.id}"><strong>${escapeHtml(item.course_draft?.code || "Course")}</strong><span>${escapeHtml(item.course_draft?.title || "Untitled course")}</span></button>`)
            .join("")}
        </div>
      </aside>
    </section>
  `;
}

function renderDraftEditor(draft) {
  return `
    <div class="review-summary">
      <div><strong>${draft.assignments.filter((item) => !item.deleted).length}</strong><span>deadlines</span></div>
      <div><strong>${draft.exams.filter((item) => !item.deleted).length}</strong><span>exams</span></div>
      <div><strong>${draft.readings.filter((item) => !item.deleted).length}</strong><span>readings</span></div>
    </div>
    <div class="button-row top-space">
      <button class="secondary-button" data-action="save-draft">Save review</button>
      <button class="primary-button" data-action="confirm-draft">Approve and build plan</button>
    </div>
    <div class="panel-grid top-space">
      <label class="field"><span>Course code</span><input data-draft-top="code" value="${escapeHtml(draft.course_draft?.code || "")}" /></label>
      <label class="field"><span>Course title</span><input data-draft-top="title" value="${escapeHtml(draft.course_draft?.title || "")}" /></label>
      <label class="field"><span>Professor</span><input data-draft-top="professor" value="${escapeHtml(draft.course_draft?.professor || "")}" /></label>
      <label class="field"><span>Office hours</span><input data-draft-top="office_hours" value="${escapeHtml(draft.course_draft?.office_hours || "")}" /></label>
    </div>
    ${renderGradingReview(draft)}
    <div class="panel-grid top-space">
      <label class="field"><span>Late policy</span><textarea data-draft-policy="late_policy">${escapeHtml(draft.course_draft?.policies?.late_policy || "")}</textarea>${sourceLine(draft, "policy")}</label>
      <label class="field"><span>Attendance policy</span><textarea data-draft-policy="attendance_policy">${escapeHtml(draft.course_draft?.policies?.attendance_policy || "")}</textarea>${sourceLine(draft, "policy")}</label>
    </div>
    <label class="field top-space"><span>Required materials</span><textarea data-draft-policy="required_materials">${escapeHtml(draft.course_draft?.policies?.required_materials || "")}</textarea>${sourceLine(draft, "policy")}</label>
    <div class="button-row top-space">
      <button class="secondary-button" data-add-draft-row="assignment">Add deadline</button>
      <button class="secondary-button" data-add-draft-row="exam">Add exam</button>
      <button class="secondary-button" data-add-draft-row="reading">Add reading</button>
    </div>
    ${renderDraftSection("Deadlines", "assignment", draft.assignments)}
    ${renderDraftSection("Exams", "exam", draft.exams)}
    ${renderDraftSection("Readings", "reading", draft.readings)}
    <div class="button-row top-space">
      <button class="secondary-button" data-action="save-draft">Save review</button>
      <button class="primary-button" data-action="confirm-draft">Approve and build plan</button>
    </div>
    ${renderWarnings(draft)}
  `;
}

function renderGradingReview(draft) {
  const weights = draft.course_draft?.grading_weights || [];
  return `
    <div class="section-header top-space">
      <h4>Grading</h4>
      <span class="minimal-note">${weights.length || 0} items</span>
    </div>
    <div class="split-list">
      ${
        weights.length
          ? weights.map((item) => `<div class="list-row"><strong>${escapeHtml(item.label)}</strong><p class="list-subcopy">${item.weight}% · ${sourceLabel(draft)}</p></div>`).join("")
          : `<div class="list-row"><p class="list-subcopy">No grading weights found yet. You can add them later on the course page.</p></div>`
      }
    </div>
  `;
}

function renderDraftSection(title, type, rows) {
  return `
    <div class="section-header top-space">
      <h4>${escapeHtml(title)}</h4>
      <span class="minimal-note">${rows.filter((item) => !item.deleted).length} active</span>
    </div>
    <div class="split-list">
      ${rows.length ? rows.map((row) => renderDraftRow(type, row)).join("") : `<div class="editable-row"><span class="list-subcopy">No ${title.toLowerCase()} found yet.</span></div>`}
    </div>
  `;
}

function renderDraftRow(type, row) {
  const dateField = type === "exam" ? "exam_date" : "due_date";
  const metaField =
    type === "reading"
      ? `<label class="field"><span>Pages</span><input value="${escapeHtml(row.pages || "")}" data-draft-row="${type}" data-row-id="${row.id}" data-field="pages" /></label>`
      : `<label class="field"><span>Grade weight</span><input type="number" min="0" max="100" value="${escapeHtml(row.weight ?? 0)}" data-draft-row="${type}" data-row-id="${row.id}" data-field="weight" /></label>`;
  return `
    <div class="editable-row ${row.deleted ? "muted-row" : ""}">
      <div class="panel-grid">
        <label class="field"><span>Title</span><input value="${escapeHtml(row.title || "")}" data-draft-row="${type}" data-row-id="${row.id}" data-field="title" /></label>
        <label class="field"><span>${type === "exam" ? "Exam date" : "Due date"}</span><input type="date" value="${row[dateField] || ""}" data-draft-row="${type}" data-row-id="${row.id}" data-field="${dateField}" /></label>
        ${metaField}
        <label class="field"><span>Confidence</span><select data-draft-row="${type}" data-row-id="${row.id}" data-field="confidence">${["high", "medium", "low"].map((option) => `<option value="${option}" ${row.confidence === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>
      </div>
      <div class="source-card">
        <span class="urgency-chip ${row.confidence || "medium"}">${escapeHtml(row.confidence || "medium")} confidence</span>
        <button class="source-button" data-source-title="${escapeHtml(sourceLabelForRow(row))}" data-source-excerpt="${escapeHtml(sourceExcerptForRow(row))}">${escapeHtml(sourceLabelForRow(row))}</button>
        <p>${escapeHtml(sourceExcerptForRow(row))}</p>
      </div>
      <div class="button-row top-space">
        <button class="ghost-button" data-toggle-draft-row="${type}" data-row-id="${row.id}">${row.deleted ? "Restore item" : "Remove item"}</button>
      </div>
    </div>
  `;
}

function renderWarnings(draft) {
  return `
    <div class="quiet-list top-space">
      ${(draft.warnings || []).length
        ? draft.warnings.map((warning) => `<div class="quiet-item"><strong>Worth checking</strong><span class="list-subcopy">${escapeHtml(warning)}</span></div>`).join("")
        : `<div class="quiet-item"><strong>Looks ready</strong><span class="list-subcopy">No major issues found in this review.</span></div>`}
    </div>
  `;
}

function renderReviewSummaryHeader(draft) {
  const stats = reviewStats(draft);
  return `
    <div class="review-summary-header">
      <div>
        <p class="eyebrow">Step 2 · Review import</p>
        <h2>Review ${escapeHtml(draft.course_draft?.code || "Course")} import</h2>
        <p>Approve what Class Compass found before it enters your plan.</p>
      </div>
      <div class="review-meta-grid">
        <div><span>Source</span><strong>${escapeHtml(sourceLabel(draft))}</strong></div>
        <div><span>Confidence</span><strong>${draftConfidence(draft)}%</strong></div>
        <div><span>Deadlines</span><strong>${stats.deadlines}</strong></div>
        <div><span>Exams</span><strong>${stats.exams}</strong></div>
        <div><span>Readings</span><strong>${stats.readings}</strong></div>
        <div><span>Flagged</span><strong>${stats.flagged}</strong></div>
      </div>
      <div class="button-row">
        <button class="primary-button" data-action="approve-clean-items">Approve clean items</button>
        <button class="secondary-button" data-action="review-flagged">Review flagged items</button>
      </div>
    </div>
  `;
}

function renderReviewTabs(draft) {
  const stats = reviewStats(draft);
  const tabs = [
    ["flagged", "Flagged"],
    ["details", "Course details"],
    ["deadlines", "Deadlines"],
    ["exams", "Exams"],
    ["readings", "Readings"],
    ["grading", "Grading"],
    ["policies", "Policies"],
  ];
  return `<div class="review-tabs">${tabs.map(([id, labelText]) => `<button class="${state.ui.reviewTab === id ? "active" : ""}" data-review-tab="${id}">${labelText}<span>${stats[id] ?? ""}</span></button>`).join("")}</div>`;
}

function renderReviewTable(draft) {
  const rows = reviewItemsForDraft(draft, state.ui.reviewTab);
  const addType = { deadlines: "assignment", exams: "exam", readings: "reading" }[state.ui.reviewTab];
  return `
    <div class="review-table-card">
      ${addType ? `<div class="review-table-actions"><button class="secondary-button" data-add-draft-row="${addType}">Add ${addType === "assignment" ? "deadline" : addType}</button></div>` : ""}
      <div class="review-table">
        <div class="review-table-head"><span></span><span>Item</span><span>Date</span><span>Weight</span><span>Type</span><span>Confidence</span><span>Source</span><span></span></div>
        ${rows.length ? rows.map(renderReviewRow).join("") : renderCompactEmpty("Nothing in this section", "Flagged or approved items will appear in their matching tab.")}
      </div>
    </div>
  `;
}

function renderReviewRow(item) {
  const selected = item.id === state.ui.selectedReviewItemId && item.type === state.ui.selectedReviewItemType;
  return `
    <div class="review-row ${selected ? "selected" : ""} ${item.deleted ? "muted-row" : ""}" data-select-review="${item.type}" data-row-id="${item.id}">
      <label class="review-check"><input type="checkbox" data-review-approve="${item.type}" data-row-id="${item.id}" ${item.approved !== false ? "checked" : ""} /></label>
      <div class="review-title-cell">
        ${selected && item.editable ? `<input data-review-field="${item.type}" data-row-id="${item.id}" data-field="title" value="${escapeHtml(item.title)}" />` : `<strong>${escapeHtml(item.title || "Untitled item")}</strong>`}
        ${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ""}
      </div>
      <span>${selected && item.dateField ? `<input type="date" data-review-field="${item.type}" data-row-id="${item.id}" data-field="${item.dateField}" value="${escapeHtml(item.date || "")}" />` : escapeHtml(item.date ? formatLong(item.date) : "No date")}</span>
      <span>${selected && item.weightField ? `<input type="number" data-review-field="${item.type}" data-row-id="${item.id}" data-field="${item.weightField}" value="${escapeHtml(item.weight ?? 0)}" />` : item.weight ? `${item.weight}%` : item.kind === "policy" ? "Info" : "-"}</span>
      <span class="minimal-note">${escapeHtml(item.kindLabel)}</span>
      <span class="confidence-badge ${confidenceClass(item.confidence)}">${escapeHtml(item.confidenceLabel)}</span>
      <button class="source-button" data-source-title="${escapeHtml(item.sourceTitle)}" data-source-excerpt="${escapeHtml(item.sourceExcerpt)}">Source</button>
      ${item.editable ? `<button class="ghost-button compact-icon" data-review-remove="${item.type}" data-row-id="${item.id}">${item.deleted ? "Restore" : "Remove"}</button>` : "<span></span>"}
    </div>
  `;
}

function renderReviewSidePanel(draft) {
  const item = selectedReviewItem(draft);
  const stats = reviewStats(draft);
  if (!item) {
    return `
      <aside class="review-side-panel">
        <p class="eyebrow">Review progress</p>
        <h3>${stats.approved} approved</h3>
        <div class="review-progress-list">
          <div><span>Need review</span><strong>${stats.needsReview}</strong></div>
          <div><span>Flagged</span><strong>${stats.flagged}</strong></div>
          <div><span>Missing dates</span><strong>${stats.missingDates}</strong></div>
        </div>
        <button class="secondary-button" data-action="review-flagged">Review flagged items</button>
      </aside>
    `;
  }
  return `
    <aside class="review-side-panel">
      <p class="eyebrow">Selected item</p>
      <h3>${escapeHtml(item.title || "Untitled item")}</h3>
      <div class="review-progress-list">
        <div><span>Confidence</span><strong>${escapeHtml(item.confidenceLabel)}</strong></div>
        <div><span>Type</span><strong>${escapeHtml(item.kindLabel)}</strong></div>
        <div><span>Suggestion</span><strong>${escapeHtml(suggestedCorrection(item))}</strong></div>
      </div>
      <div class="source-preview"><span>${escapeHtml(item.sourceTitle)}</span><p>${escapeHtml(item.sourceExcerpt || "No exact source excerpt was captured. Open the document source for context.")}</p></div>
      <div class="button-row">
        <button class="primary-button" data-review-approve-button="${item.type}" data-row-id="${item.id}">Approve</button>
        <button class="secondary-button" data-source-title="${escapeHtml(item.sourceTitle)}" data-source-excerpt="${escapeHtml(item.sourceExcerpt)}">Open source</button>
        ${item.editable ? `<button class="ghost-button danger" data-review-remove="${item.type}" data-row-id="${item.id}">${item.deleted ? "Restore" : "Remove"}</button>` : ""}
      </div>
    </aside>
  `;
}

function renderStickyReviewBar(draft) {
  const stats = reviewStats(draft);
  return `<div class="sticky-review-bar"><span>${stats.approved} approved, ${stats.needsReview} need review</span><div class="button-row"><button class="secondary-button" data-action="save-draft">Save draft</button><button class="primary-button" data-action="confirm-draft">Approve and build plan</button></div></div>`;
}

function renderToday() {
  const snapshot = plannerSnapshot();
  const risk = state.weeklyReset || buildWeeklyReset(snapshot, state.courses);
  const overdueCount = [...state.tasks, ...state.assignments].filter((item) => dateState(item.due_date).key === "overdue" && !item.completed).length;
  const dueWeekCount = snapshot.dueSoon.filter((item) => daysUntil(item.due_date) <= 7 && daysUntil(item.due_date) >= 0).length;
  const nextAction = bestNextAction(snapshot);
  const todayQueue = buildTodayQueue(snapshot, nextAction).filter((item) => !item.completed).slice(0, 6);
  const completedToday = state.tasks.filter((task) => task.completed_at?.slice(0, 10) === isoDay()).slice(0, 8);
  return `
    <section class="view-grid">
      <article class="today-hero span-12">
        <div class="today-hero-copy">
          <p class="eyebrow">Today</p>
          <h2>${greeting()}, ${escapeHtml(state.profile?.first_name || "student")}</h2>
          <p class="body-copy">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          <div class="summary-chips">
            <span class="urgency-chip ${overdueCount ? "overdue" : "quick"}">${overdueCount} overdue</span>
            <span class="urgency-chip due-soon">${dueWeekCount} due this week</span>
            <span class="urgency-chip high-impact">${snapshot.highImpact.length} high impact</span>
          </div>
        </div>
        ${renderNextBestAction(nextAction)}
      </article>
      <article class="command-panel span-7">
        <div class="section-intro compact"><p class="eyebrow">Today queue</p><h3>Start here. These are the highest-value moves today.</h3></div>
        <div class="task-list top-space">
          ${todayQueue.length ? todayQueue.map(renderQueueRow).join("") : renderCompactEmpty("No queue yet", "Upload a syllabus to build your first recommended tasks.")}
        </div>
        ${completedToday.length ? `<button class="link-button top-space" data-action="toggle-completed">${state.ui.completedCollapsed ? "Show" : "Hide"} completed today (${completedToday.length})</button>${state.ui.completedCollapsed ? "" : `<div class="task-list top-space completed-list">${completedToday.map(renderQueueRow).join("")}</div>`}` : ""}
      </article>
      <article class="support-panel span-5">
        <div class="section-intro compact"><p class="eyebrow">Risk alerts</p><h3>This week</h3></div>
        <div class="risk-stack">
          ${renderRiskCard("Workload", risk.wins || risk.summary?.wins || "", "calendar", "calendar")}
          ${renderRiskCard("Cluster check", risk.risks || risk.summary?.risks || "", "risk", "calendar")}
          ${renderRiskCard("Grade impact", risk.high_impact || risk.summary?.high_impact || "", "target", "assignments")}
        </div>
      </article>
      <article class="card span-7">
        <div class="section-intro compact"><p class="eyebrow">This week's workload</p><h3>Semester Map preview</h3></div>
        ${renderWeekStrip()}
      </article>
      <article class="card span-5">
        <div class="section-intro compact"><p class="eyebrow">Due soon</p><h3>Upcoming deadlines</h3></div>
        <div class="task-list">${snapshot.dueSoon.length ? snapshot.dueSoon.map((item) => renderDeadlineRow(item, "due_date")).join("") : renderEmpty("No deadlines yet", "Upload another syllabus or course file to expand the plan.")}</div>
      </article>
      <article class="card span-5">
        <div class="section-intro compact"><p class="eyebrow">Needs your review</p><h3>Course files</h3></div>
        ${state.draftImports.length ? state.draftImports.map((draft) => `<button class="course-row" data-open-draft="${draft.id}"><strong>${escapeHtml(draft.course_draft?.title || "Course review")}</strong><span class="minimal-note">Review</span></button>`).join("") : renderCompactEmpty("Nothing waiting", "Approved class details are already in your plan.")}
      </article>
      <article class="card span-7">
        <div class="section-intro compact"><p class="eyebrow">High-impact assignments</p><h3>Protect your grade</h3></div>
        <div class="task-list">${snapshot.highImpact.length ? snapshot.highImpact.map((item) => renderDeadlineRow(item, "due_date")).join("") : renderCompactEmpty("No high-impact work found", "Grade-heavy items will appear here when they are approved.")}</div>
      </article>
    </section>
  `;
}

function renderWeekStrip() {
  const weeks = semesterWeeks({ assignments: state.assignments, exams: state.exams, readings: state.readings }).slice(0, 6);
  if (!weeks.length) return renderEmpty("No map yet", "Approved dates will build your workload map.");
  return `<div class="workload-timeline">${weeks.map(renderWorkloadWeek).join("")}</div>`;
}

function renderSemesterMap() {
  const weeks = semesterWeeks({ assignments: state.assignments, exams: state.exams, readings: state.readings });
  const cells = monthMatrix([
    ...state.assignments.map((item) => ({ label: item.title, date: item.due_date })),
    ...state.exams.map((item) => ({ label: item.title, date: item.exam_date })),
    ...state.readings.map((item) => ({ label: item.title, date: item.due_date })),
  ]);
  return `
    <section class="view-grid">
      <article class="semester-map-panel span-12">
        <div class="section-intro compact"><p class="eyebrow">Semester Map</p><h3>See crunch weeks before they happen.</h3></div>
        ${weeks.length ? `<div class="timeline-rail">${weeks.map(renderTimelineWeek).join("")}</div>` : renderCompactEmpty("No approved dates yet", "Approve extracted deadlines to build the semester map.")}
        <div class="timeline-legend"><span class="calm">Calm</span><span class="normal">Normal</span><span class="heavy">Heavy</span><span class="crunch">Crunch</span></div>
      </article>
      <details class="support-panel span-12 calendar-disclosure">
        <summary><span>Monthly calendar</span><small>Secondary view</small></summary>
        <div class="calendar-grid">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-header">${day}</div>`).join("")}
          ${cells.map((cell) => (cell.empty ? `<div class="calendar-day empty"></div>` : `<div class="calendar-day ${cell.isToday ? "today" : ""}"><div class="calendar-date">${cell.day}</div>${cell.items.map((item) => `<span class="calendar-pill">${escapeHtml(item.label)}</span>`).join("")}</div>`)).join("")}
        </div>
      </details>
    </section>
  `;
}

function renderWorkloadWeek(week) {
  const reason = week.items
    .slice(0, 3)
    .map((item) => item.title)
    .join(" + ");
  return `<button class="workload-week ${week.level}">
    <span class="workload-bar" style="--load:${Math.min(100, week.items.length * 24)}%"></span>
    <strong>${escapeHtml(week.label)}</strong>
    <span>${escapeHtml(week.levelLabel)} · ${week.items.length} item${week.items.length === 1 ? "" : "s"}</span>
    <p>${escapeHtml(reason || week.summary)}</p>
  </button>`;
}

function renderTimelineWeek(week) {
  const pills = week.items.slice(0, 3).map((item) => `<span>${escapeHtml(shortEventName(item.title))}</span>`).join("");
  return `<button class="timeline-week ${week.level}" data-week-id="${escapeHtml(week.start)}">
    <strong>${escapeHtml(week.label.replace("Week of ", ""))}</strong>
    <b>${escapeHtml(week.levelLabel)}</b>
    <small>${week.items.length} item${week.items.length === 1 ? "" : "s"}</small>
    <div class="event-pills">${pills || "<span>No major work</span>"}</div>
    <em>${escapeHtml(week.summary)}</em>
  </button>`;
}

function renderCourseCommandCenter() {
  const course = selectedCourse();
  if (!course) return renderCompactEmpty("No courses yet", "Upload a syllabus to create your first course command center.");
  const courseAssignments = state.assignments.filter((item) => item.course_id === course.id);
  const courseExams = state.exams.filter((item) => item.course_id === course.id);
  const courseReadings = state.readings.filter((item) => item.course_id === course.id);
  const courseDocuments = state.documents.filter((item) => item.course_id === course.id);
  const courseTasks = state.tasks.filter((item) => item.course_id === course.id && !item.completed).slice(0, 5);
  const nextDeadline = [...courseAssignments, ...courseExams.map((exam) => ({ ...exam, due_date: exam.exam_date }))].filter((item) => item.due_date).sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
  return renderCourseWorkspace(course, { courseAssignments, courseExams, courseReadings, courseDocuments, courseTasks, nextDeadline });
  return `
    <section class="detail-grid">
      <article class="support-panel">
        <div class="section-intro compact"><p class="eyebrow">Courses</p><h3>Your classes</h3></div>
        <div class="course-list">${state.courses.map(renderCourseListRow).join("")}</div>
      </article>
      <article class="course-command">
        <div class="course-command-header">
          <div>
            <span class="course-tag" style="--course-color:${escapeHtml(course.color || "#1f6feb")}">${escapeHtml(course.code)}</span>
            <h2>${escapeHtml(course.title)}</h2>
            <p>${escapeHtml(course.professor || "Professor not added")} · ${escapeHtml(course.office_hours || "Office hours not added")}</p>
          </div>
          ${nextDeadline ? `<div class="next-deadline"><span class="eyebrow">Next deadline</span><strong>${escapeHtml(nextDeadline.title)}</strong><small>${formatLong(nextDeadline.due_date)} · ${nextDeadline.weight || 0}% · ${dateState(nextDeadline.due_date).detail}</small></div>` : ""}
        </div>
        <div class="course-tabs"><button class="active">Overview</button><button>Assignments</button><button>Materials</button><button>Study</button><button>Policies</button></div>
        <div class="button-row command-actions">
          <button class="secondary-button" data-route="assignments">Decode assignment</button>
          <button class="secondary-button" data-route="study">Make study plan</button>
          <button class="secondary-button" data-route="study">Ask course</button>
          <button class="ghost-button" data-prompt="Prep office-hours questions">Office-hours prep</button>
        </div>
        <div class="course-overview-grid">
          <section>
            <div class="section-header"><h4>This week</h4></div>
            <div class="task-list">${courseTasks.length ? courseTasks.map(renderTaskRow).join("") : renderCompactEmpty("No tasks this week", "New work sessions appear here as deadlines approach.")}</div>
          </section>
          <section>
            <div class="section-header"><h4>Grade map</h4></div>
            ${renderGradeMap(course)}
          </section>
          <section>
            <div class="section-header"><h4>Materials</h4></div>
            <div class="citation-list">${courseDocuments.length ? courseDocuments.map((doc) => `<button class="citation-row" data-source-title="${escapeHtml(doc.file_name)}" data-source-excerpt="${escapeHtml(doc.preview || doc.snippets?.[0] || "")}"><strong>${escapeHtml(doc.file_name)}</strong><span class="minimal-note">${escapeHtml(doc.kind)}</span></button>`).join("") : renderCompactEmpty("No materials", "Upload notes, slides, or prompts for this course.")}</div>
          </section>
          <section>
            <div class="section-header"><h4>Upcoming</h4></div>
            <div class="task-list">${[...courseAssignments, ...courseReadings].slice(0, 6).map((item) => renderDeadlineRow(item, "due_date")).join("") || renderCompactEmpty("No approved items", "Approved deadlines and readings will show here.")}</div>
          </section>
          <section class="wide-section">
            <div class="section-header"><h4>Policies</h4></div>
            <div class="quiet-list">${renderPolicyRow("Late work", course.policies?.late_policy)}${renderPolicyRow("Attendance", course.policies?.attendance_policy)}</div>
          </section>
        </div>
      </article>
    </section>
  `;
}

function renderCourseWorkspace(course, data) {
  return `
    <section class="course-workspace">
      ${state.courses.length > 1 ? `<div class="course-selector">${state.courses.map((item) => `<button class="${item.id === course.id ? "active" : ""}" data-select-course="${item.id}"><span class="course-dot" style="background:${escapeHtml(item.color || "#2563eb")}"></span>${escapeHtml(item.code)}</button>`).join("")}</div>` : ""}
      <article class="course-command full-width">
        <div class="course-command-header">
          <div>
            <span class="course-tag" style="--course-color:${escapeHtml(course.color || "#1f6feb")}">${escapeHtml(course.code)}</span>
            <h2>${escapeHtml(course.title)}</h2>
            <p>${escapeHtml(course.professor || "Professor not added")} · ${escapeHtml(course.office_hours || "Office hours not added")}</p>
          </div>
          ${data.nextDeadline ? `<div class="next-deadline"><span class="eyebrow">Next deadline</span><strong>${escapeHtml(data.nextDeadline.title)}</strong><small>${formatLong(data.nextDeadline.due_date)} · ${data.nextDeadline.weight || 0}% · ${dateState(data.nextDeadline.due_date).detail}</small></div>` : ""}
        </div>
        <div class="button-row command-actions">
          <button class="secondary-button" data-route="assignments">Decode assignment</button>
          <button class="secondary-button" data-route="study">Make study plan</button>
          <button class="secondary-button" data-route="study">Ask course</button>
          <button class="ghost-button" data-prompt="Prep office-hours questions">Office-hours prep</button>
        </div>
        <div class="course-tabs">${["overview", "assignments", "materials", "study", "policies"].map((tab) => `<button class="${state.ui.activeCourseTab === tab ? "active" : ""}" data-course-tab="${tab}">${labelTab(tab)}</button>`).join("")}</div>
        ${renderCourseTabContent(course, data)}
      </article>
    </section>
  `;
}

function renderCourseTabContent(course, data) {
  if (state.ui.activeCourseTab === "assignments") {
    return `<div class="course-full-table">${[...data.courseAssignments, ...data.courseExams.map((exam) => ({ ...exam, due_date: exam.exam_date }))].map((item) => renderDeadlineRow(item, "due_date")).join("") || renderCompactEmpty("No assignments yet", "Approved assignments and exams will appear here.")}</div>`;
  }
  if (state.ui.activeCourseTab === "materials") {
    return `<div class="course-full-table">${data.courseDocuments.length ? data.courseDocuments.map(renderMaterialRow).join("") : renderCompactEmpty("No materials", "Upload notes, slides, or prompts for this course.")}</div>`;
  }
  if (state.ui.activeCourseTab === "study") {
    return `<div class="course-full-table"><button class="study-action-row" data-route="study">Make study plan</button><button class="study-action-row" data-route="study">Ask course</button><button class="study-action-row" data-route="study">Quiz me from materials</button></div>`;
  }
  if (state.ui.activeCourseTab === "policies") {
    return `<div class="course-full-table">${renderPolicyRow("Late policy", course.policies?.late_policy)}${renderPolicyRow("Attendance", course.policies?.attendance_policy)}${renderPolicyRow("Required materials", course.policies?.required_materials)}</div>`;
  }
  return `
    <div class="course-overview-grid command-grid">
      <section class="course-main-column">
        <div class="section-header"><h4>This week</h4></div>
        <div class="task-list">${data.courseTasks.length ? data.courseTasks.map(renderTaskRow).join("") : renderCompactEmpty("No tasks this week", "New work sessions appear here as deadlines approach.")}</div>
        <div class="section-header"><h4>Upcoming assignments</h4></div>
        <div class="task-list">${[...data.courseAssignments, ...data.courseReadings].slice(0, 8).map((item) => renderDeadlineRow(item, "due_date")).join("") || renderCompactEmpty("No approved items", "Approved deadlines and readings will show here.")}</div>
        <div class="section-header"><h4>Materials</h4></div>
        <div class="citation-list">${data.courseDocuments.length ? data.courseDocuments.map(renderMaterialRow).join("") : renderCompactEmpty("No materials", "Upload notes, slides, or prompts for this course.")}</div>
      </section>
      <aside class="course-right-rail">
        ${data.nextDeadline ? `<div class="next-deadline rail"><span class="eyebrow">Next deadline</span><strong>${escapeHtml(data.nextDeadline.title)}</strong><small>${formatLong(data.nextDeadline.due_date)} · ${data.nextDeadline.weight || 0}%</small></div>` : ""}
        <div class="section-header"><h4>Grade map</h4></div>
        ${renderGradeMap(course)}
        <div class="section-header"><h4>Policies</h4></div>
        <div class="quiet-list">${renderPolicyRow("Late policy", course.policies?.late_policy)}${renderPolicyRow("Attendance", course.policies?.attendance_policy)}</div>
      </aside>
    </div>
  `;
}

function renderAssignmentDecoder() {
  const assignment = selectedAssignment();
  return `
    <section class="decoder-workbench">
      <article class="decoder-input-panel">
        <div class="section-intro compact"><p class="eyebrow">Assignment Decoder</p><h3>Understand the work before you start</h3><p class="body-copy">Paste a prompt or rubric and turn it into a safe checklist, milestone plan, and professor questions.</p></div>
        <form id="decoder-form" class="form-grid">
          <label class="field"><span>Course</span><select name="courseId">${state.courses.map((course) => `<option value="${course.id}" ${course.id === assignment?.course_id ? "selected" : ""}>${escapeHtml(course.code)} - ${escapeHtml(course.title)}</option>`).join("")}</select></label>
          <label class="field"><span>Assignment</span><select name="assignmentId">${state.assignments.map((item) => `<option value="${item.id}" ${item.id === assignment?.id ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("")}</select></label>
          <label class="upload-dropzone compact-drop"><input name="rubric" type="file" accept=".pdf,.txt,.md" /><span class="drop-icon">${navIcon("file")}</span><strong>Upload rubric</strong><p class="hint">Optional. Paste the prompt below if you do not have a file.</p></label>
          <label class="field"><span>Prompt or rubric text</span><textarea name="prompt" placeholder="Paste the assignment prompt or rubric here..." required></textarea></label>
          <button class="primary-button" type="submit">Decode assignment</button>
        </form>
      </article>
      <article class="decoder-output-panel">${state.decoder ? renderDecoderOutput() : renderDecoderPreview()}</article>
    </section>
  `;
}

function renderDecoderPreview() {
  return `
    <div class="section-intro compact"><p class="eyebrow">Output preview</p><h3>Assignment decoded</h3></div>
    <div class="decoder-preview-list top-space">
      <div><strong>What you need to submit</strong><span>Deliverable, format, source expectations, and due date.</span></div>
      <div><strong>Checklist</strong><span>Concrete steps without writing the assignment for you.</span></div>
      <div><strong>Milestone plan</strong><span>Start, draft, revise, and submit blocks.</span></div>
      <div><strong>What could lose points</strong><span>Rubric risks and hidden requirements.</span></div>
      <div><strong>Questions to ask professor</strong><span>Clarify ambiguity before you start.</span></div>
    </div>
  `;
}

function renderDecoderOutput() {
  const decoder = state.decoder;
  return `
    <div class="section-intro compact"><p class="eyebrow">Decoded</p><h3>Before you start</h3></div>
    <div class="decode-artifact top-space">
      <div class="submit-card"><span class="eyebrow">Submit</span><strong>${escapeHtml(decoder.summary)}</strong><small>${decoder.due_date ? `Due ${formatLong(decoder.due_date)}` : "Due date not set"}</small></div>
      ${renderDecoderList("Checklist", decoder.checklist)}
      ${renderDecoderList("Milestone plan", decoder.milestones)}
      ${renderDecoderList("Could lose points", decoder.pointRisks)}
      ${renderDecoderList("Ask professor", decoder.questions)}
      ${renderCitationBlock(decoder.citations)}
      <div class="button-row"><button class="secondary-button">Copy checklist</button><button class="primary-button" data-action="decoder-to-tasks">Add milestones to plan</button></div>
    </div>
  `;
}

function renderStudyMode() {
  const course = selectedCourse();
  const docs = state.documents.filter((doc) => !course || doc.course_id === course.id);
  const guide = buildStudyGuide({ course, documents: docs });
  const cards = buildFlashcards({ course, documents: docs });
  const quiz = generateQuiz({ course, documents: docs });
  const syllabusOnly = docs.length > 0 && !guide.hasAcademicContent;
  return `
    <section class="detail-grid">
      <article class="card">
        <div class="section-intro compact"><p class="eyebrow">Study Mode</p><h3>${course ? escapeHtml(course.title) : "Choose a course"}</h3><p class="body-copy">Study from ${docs.length} uploaded source${docs.length === 1 ? "" : "s"}. Outputs cite course material when possible.</p></div>
        ${syllabusOnly ? renderSyllabusOnlyStudy(course) : ""}
        <div class="segmented-control bottom-space">
          ${["guide", "flashcards", "quiz", "explain", "exam"].map((mode) => {
            const locked = syllabusOnly && ["guide", "flashcards", "quiz"].includes(mode);
            return `<button class="${state.ui.studyMode === mode ? "active" : ""} ${locked ? "locked" : ""}" ${locked ? "disabled title=\"Upload academic content to generate study materials.\"" : `data-study-mode="${mode}"`}>${studyLabel(mode)}</button>`;
          }).join("")}
        </div>
        ${syllabusOnly && ["guide", "flashcards", "quiz"].includes(state.ui.studyMode) ? "" : renderStudyPanel(guide, cards, quiz)}
      </article>
      <article class="card">
        <div class="section-intro compact"><p class="eyebrow">Grounded chat</p><h3>Ask from your materials</h3></div>
        <div class="suggested-prompts">
          ${["What should I study first?", "Quiz me on this.", "Explain this like I am lost.", "Make a 3-day exam plan."].map((prompt) => `<button data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join("")}
        </div>
        <div class="chat-thread">${state.chatMessages.length ? state.chatMessages.map(renderChatBubble).join("") : `<div class="soft-empty"><strong>Ask your course</strong><p>Use the prompts above or ask about a policy, concept, reading, or exam topic from uploaded files.</p></div>`}</div>
        <form id="study-form" class="form-grid">
          <label class="field"><span>Question</span><textarea name="question" placeholder="Explain this concept, quiz me, or make an exam plan." required></textarea></label>
          <button class="primary-button" type="submit">Ask from my materials</button>
        </form>
      </article>
    </section>
  `;
}

function renderSyllabusOnlyStudy(course) {
  return `<div class="study-empty-state">
    <h4>You have a syllabus, but no lecture notes yet.</h4>
    <p>I can still help plan your study schedule. Upload notes, slides, readings, or review sheets to unlock grounded study guides, flashcards, and quizzes.</p>
    <div class="button-row">
      <button class="secondary-button" data-study-mode="exam">Make exam plan</button>
      <button class="secondary-button" data-prompt="Create reading schedule">Create reading schedule</button>
      <button class="secondary-button" data-prompt="Explain late policy">Explain late policy</button>
      <button class="secondary-button" data-prompt="Prep office-hours questions">Prep office-hours questions</button>
    </div>
  </div>`;
}

function renderStudyPanel(guide, cards, quiz) {
  if (state.ui.studyMode === "flashcards") {
    return `<div class="split-list">${cards.length ? cards.map((card) => `<div class="list-row"><strong>${escapeHtml(card.front)}</strong><p class="list-subcopy">${escapeHtml(card.back)}</p><small>${escapeHtml(card.citation.source_file)}</small></div>`).join("") : renderEmpty("No flashcards yet", "Upload course material to create flashcards.")}</div>`;
  }
  if (state.ui.studyMode === "quiz") {
    return `<div class="quiet-list">${quiz.length ? quiz.map((item) => `<div class="quiet-item"><strong>${escapeHtml(item.question)}</strong><span class="list-subcopy">${escapeHtml(item.prompt)}</span></div>`).join("") : `<div class="quiet-item"><span class="list-subcopy">Upload notes or review sheets to generate quiz prompts.</span></div>`}</div>`;
  }
  if (state.ui.studyMode === "explain") {
    return renderEmpty("Ask what to explain", "Use grounded chat to ask about a specific concept from your materials.");
  }
  if (state.ui.studyMode === "exam") {
    return `<div class="quiet-list"><div class="quiet-item"><strong>Exam plan</strong><span class="list-subcopy">Start with the nearest exam, review cited notes first, then do one quiz block and one final review block.</span></div>${renderCitationRows(guide.citations)}</div>`;
  }
  return `<div class="study-guide">
    <div class="study-section"><strong>${escapeHtml(guide.title)}</strong><span>${escapeHtml(guide.sections?.keyTopics || "Upload source material to identify key topics.")}</span></div>
    <div class="study-section"><strong>What to know</strong><span>${escapeHtml(guide.sections?.whatToKnow || "Class Compass needs more notes or slides to make this specific.")}</span></div>
    <div class="study-section"><strong>Practice questions</strong><span>${escapeHtml(guide.sections?.practice || "Ask grounded chat to quiz you from uploaded material.")}</span></div>
    <div class="study-section"><strong>Weak spots</strong><span>${escapeHtml(guide.sections?.weakSpots || "Mark confusing lecture points as you upload more course files.")}</span></div>
    <div class="study-section"><strong>Sources</strong><div class="citation-list">${renderCitationRows(guide.citations)}</div></div>
  </div>`;
}

function renderUpload() {
  return `
    <section class="upload-layout">
      <article class="command-panel">
        <p class="eyebrow">Upload</p>
        <h2>Add course material.</h2>
        <p class="body-copy">Upload a syllabus, rubric, prompt, notes, or exam review sheet. Class Compass extracts what matters and asks you to approve it first.</p>
        <div class="material-type-chips"><button class="active">Syllabus</button><button>Assignment</button><button>Rubric</button><button>Notes</button><button>Slides</button><button>Exam Review</button></div>
        ${renderUploadForm("Build my class plan")}
        <button class="link-button top-space" data-action="sample-syllabus">Try sample syllabus</button>
      </article>
      <aside class="support-panel">
        <h3>Needs your review</h3>
        <div class="metric-strip"><span>${state.draftImports.length} pending</span><span>${state.documents.length} uploads</span></div>
        ${state.draftImports.length ? state.draftImports.map((draft) => `<button class="review-picker" data-open-draft="${draft.id}"><strong>${escapeHtml(draft.course_draft?.title || "Course review")}</strong><span>Review found items</span></button>`).join("") : renderCompactEmpty("No files waiting", "New uploads will appear here for approval.")}
        <p class="minimal-note top-space">Accepted: PDF with selectable text, TXT, Markdown, CSV.</p>
      </aside>
    </section>
  `;
}

function renderSettings() {
  return `
    <section class="detail-grid">
      <article class="card">
        <div class="section-intro compact"><p class="eyebrow">Settings</p><h3>Profile</h3></div>
        <form id="profile-form" class="form-grid">
          <label class="field"><span>First name</span><input name="first_name" value="${escapeHtml(state.profile?.first_name || "")}" /></label>
          <label class="field"><span>School</span><input name="school" value="${escapeHtml(state.profile?.school || "")}" /></label>
          <div class="panel-grid">
            <label class="field"><span>Term</span><input name="term" value="${escapeHtml(state.profile?.term || "")}" /></label>
            <label class="field"><span>Planning style</span><select name="energy_mode">${["Balanced", "Gentle", "High structure"].map((option) => `<option value="${option}" ${state.profile?.energy_mode === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>
          </div>
          <button class="primary-button" type="submit">Save profile</button>
        </form>
      </article>
      <article class="card">
        <div class="section-intro compact"><p class="eyebrow">Local workspace</p><h3>Saved on this device</h3><p class="body-copy">Your files and plan are stored in this browser on this device.</p></div>
        <div class="quiet-list">
          <div class="settings-row"><strong>Courses</strong><span>${state.courses.length}</span></div>
          <div class="settings-row"><strong>Documents</strong><span>${state.documents.length}</span></div>
          <div class="settings-row"><strong>Approved class details</strong><span>${state.assignments.length + state.exams.length + state.readings.length}</span></div>
        </div>
        <div class="section-header"><h4>Data controls</h4></div>
        <div class="button-row">
          <button class="secondary-button" data-action="export-workspace">Export data</button>
          <button class="ghost-button danger" data-action="reset-workspace">Clear local data</button>
        </div>
      </article>
      <article class="card">
        <div class="section-intro compact"><p class="eyebrow">Privacy</p><h3>Academic integrity first</h3></div>
        <div class="quiet-list">
          <div class="quiet-item"><strong>No final submissions</strong><span class="list-subcopy">Class Compass helps you organize, understand, quiz, and study. It does not write final work for you.</span></div>
          <div class="quiet-item"><strong>Source-grounded answers</strong><span class="list-subcopy">Study answers cite uploaded materials when there is enough source context.</span></div>
          <div class="quiet-item"><strong>You approve imports</strong><span class="list-subcopy">Extracted items never enter your plan until you approve them.</span></div>
        </div>
      </article>
    </section>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.onclick = () => {
      window.location.hash = `#/${button.dataset.route}`;
    };
  });
  document.querySelectorAll("[data-action='go-upload']").forEach((button) => {
    button.onclick = () => {
      window.location.hash = "#/upload";
    };
  });
  document.querySelectorAll("[data-action='reset-workspace']").forEach((button) => {
    button.onclick = async () => {
      clearLocalWorkspace();
      clearWorkspace();
      state.session = await getSession();
      state.user = state.session.user;
      await hydrateWorkspace();
      state.ui.route = "today";
      state.ui.status = "Local workspace cleared.";
      window.location.hash = "#/today";
      render();
    };
  });
  document.querySelectorAll("[data-action='export-workspace']").forEach((button) => {
    button.onclick = () => {
      const payload = JSON.stringify(
        {
          profile: state.profile,
          courses: state.courses,
          documents: state.documents,
          assignments: state.assignments,
          exams: state.exams,
          readings: state.readings,
          tasks: state.tasks,
          decoder: state.decoder,
        },
        null,
        2
      );
      const blob = new Blob([payload], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "class-compass-workspace.json";
      link.click();
      URL.revokeObjectURL(link.href);
      state.ui.status = "Workspace exported.";
      render();
    };
  });
  document.querySelectorAll("[data-action='close-source']").forEach((button) => {
    button.onclick = () => {
      state.ui.sourceDrawer = null;
      render();
    };
  });
  document.querySelectorAll("[data-source-title]").forEach((button) => {
    button.onclick = () => {
      state.ui.sourceDrawer = {
        title: button.dataset.sourceTitle,
        excerpt: button.dataset.sourceExcerpt,
      };
      render();
    };
  });
  document.querySelectorAll("[data-action='start-task']").forEach((button) => {
    button.onclick = async () => {
      const taskId = button.dataset.taskId;
      if (!state.tasks.some((task) => task.id === taskId)) {
        showToast("No task found for this action.");
        return;
      }
      await updateTask(state.user.id, taskId, { in_progress: true });
      await hydrateWorkspace();
      state.ui.focusTaskId = taskId;
      render();
    };
  });
  document.querySelectorAll("[data-action='close-focus']").forEach((button) => {
    button.onclick = () => {
      state.ui.focusTaskId = "";
      render();
    };
  });
  document.querySelectorAll("[data-action='complete-focus']").forEach((button) => {
    button.onclick = async () => {
      await completeTask(state.user.id, button.dataset.taskId);
      await hydrateWorkspace();
      state.ui.focusTaskId = "";
      showToast("Task completed.");
      render();
    };
  });
  document.querySelectorAll("[data-action='break-task']").forEach((button) => {
    button.onclick = () => {
      state.ui.stepsTaskId = button.dataset.taskId;
      render();
    };
  });
  document.querySelectorAll("[data-action='close-steps']").forEach((button) => {
    button.onclick = () => {
      state.ui.stepsTaskId = "";
      render();
    };
  });
  document.querySelectorAll("[data-action='add-subtasks']").forEach((button) => {
    button.onclick = async () => {
      const task = state.tasks.find((item) => item.id === button.dataset.taskId);
      if (!task) return;
      await addSubtasks(state.user.id, task.id, taskSteps(task));
      await hydrateWorkspace();
      state.ui.stepsTaskId = "";
      showToast("Steps added to Today Queue.");
      render();
    };
  });
  document.querySelectorAll("[data-action='open-task']").forEach((button) => {
    button.onclick = () => {
      const task = state.tasks.find((item) => item.id === button.dataset.taskId);
      if (!task) return;
      const source = sourceForTask(task);
      if (task.course_id) state.ui.selectedCourseId = task.course_id;
      if (source) {
        state.ui.sourceDrawer = { title: source.title, excerpt: source.excerpt };
      } else {
        showToast("No matching source found.");
      }
      window.location.hash = "#/courses";
      render();
    };
  });
  document.querySelectorAll("[data-action='toggle-completed']").forEach((button) => {
    button.onclick = () => {
      state.ui.completedCollapsed = !state.ui.completedCollapsed;
      render();
    };
  });
  document.querySelectorAll("[data-risk-route]").forEach((button) => {
    button.onclick = () => {
      window.location.hash = `#/${button.dataset.riskRoute}`;
    };
  });
  document.querySelectorAll("[data-week-id]").forEach((button) => {
    button.onclick = () => {
      state.ui.activeWeekId = button.dataset.weekId;
      render();
    };
  });
  document.querySelectorAll("[data-action='close-week']").forEach((button) => {
    button.onclick = () => {
      state.ui.activeWeekId = "";
      render();
    };
  });
  document.querySelectorAll("[data-course-tab]").forEach((button) => {
    button.onclick = () => {
      state.ui.activeCourseTab = button.dataset.courseTab;
      render();
    };
  });
  document.querySelectorAll("[data-review-tab]").forEach((button) => {
    button.onclick = () => {
      state.ui.reviewTab = button.dataset.reviewTab;
      state.ui.selectedReviewItemId = "";
      state.ui.selectedReviewItemType = "";
      render();
    };
  });
  document.querySelectorAll("[data-select-review]").forEach((row) => {
    row.onclick = (event) => {
      if (event.target.closest("button") || event.target.closest("input")) return;
      state.ui.selectedReviewItemType = row.dataset.selectReview;
      state.ui.selectedReviewItemId = row.dataset.rowId;
      render();
    };
  });
  document.querySelectorAll("[data-action='review-flagged']").forEach((button) => {
    button.onclick = () => {
      state.ui.reviewTab = "flagged";
      state.ui.selectedReviewItemId = "";
      state.ui.selectedReviewItemType = "";
      render();
    };
  });
  document.querySelectorAll("[data-action='approve-clean-items']").forEach((button) => {
    button.onclick = () => {
      const draft = selectedDraft();
      if (!draft) return;
      applyReviewDefaults(draft);
      (draft.assignments || []).forEach((row) => {
        if (isCleanReviewRow(row, "assignment")) row.approved = true;
      });
      (draft.exams || []).forEach((row) => {
        if (isCleanReviewRow(row, "exam")) row.approved = true;
      });
      (draft.readings || []).forEach((row) => {
        if (isCleanReviewRow(row, "reading")) row.approved = true;
      });
      (draft.course_draft?.grading_weights || []).forEach((row) => {
        row.approved = true;
      });
      state.ui.status = "Clean items approved.";
      render();
    };
  });
  document.querySelectorAll("[data-review-approve]").forEach((input) => {
    input.onchange = () => {
      setReviewRowValue(input.dataset.reviewApprove, input.dataset.rowId, "approved", input.checked);
      render();
    };
  });
  document.querySelectorAll("[data-review-approve-button]").forEach((button) => {
    button.onclick = () => {
      setReviewRowValue(button.dataset.reviewApproveButton, button.dataset.rowId, "approved", true);
      render();
    };
  });
  document.querySelectorAll("[data-review-remove]").forEach((button) => {
    button.onclick = () => {
      const row = reviewRowByType(selectedDraft(), button.dataset.reviewRemove, button.dataset.rowId);
      if (row) row.deleted = !row.deleted;
      render();
    };
  });
  document.querySelectorAll("[data-review-field]").forEach((input) => {
    input.oninput = () => {
      setReviewRowValue(input.dataset.reviewField, input.dataset.rowId, input.dataset.field, input.dataset.field === "weight" ? Number(input.value || 0) : input.value);
    };
  });
  document.getElementById("upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = Array.from(event.currentTarget.elements.files.files || []);
    await processCourseFiles(files);
    render();
  });
  document.querySelectorAll("[data-action='sample-syllabus']").forEach((button) => {
    button.onclick = async () => {
      const file = new File([sampleSyllabusText()], "BIO 142 Syllabus.txt", { type: "text/plain" });
      await processCourseFiles([file]);
      render();
    };
  });
  document.querySelectorAll("[data-open-draft]").forEach((button) => {
    button.onclick = () => {
      state.ui.selectedDraftId = button.dataset.openDraft;
      render();
    };
  });
  document.querySelectorAll("[data-select-course]").forEach((button) => {
    button.onclick = async () => {
      state.ui.selectedCourseId = button.dataset.selectCourse;
      state.chatMessages = await loadChatMessages(state.user.id, state.ui.selectedCourseId || null);
      render();
    };
  });
  document.querySelectorAll("[data-task-toggle]").forEach((input) => {
    input.onchange = async () => {
      await withFeedback(async () => {
        await toggleTask(state.user.id, input.dataset.taskToggle, input.checked);
        await hydrateWorkspace();
      });
      render();
    };
  });
  document.getElementById("profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await withFeedback(async () => {
      await saveProfile(state.user.id, Object.fromEntries(data.entries()));
      await hydrateWorkspace();
      state.ui.status = "Profile saved.";
    });
    render();
  });
  document.getElementById("decoder-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const assignment = state.assignments.find((item) => item.id === String(data.get("assignmentId"))) || selectedAssignment();
    const course = state.courses.find((item) => item.id === String(data.get("courseId"))) || state.courses.find((item) => item.id === assignment?.course_id) || null;
    let prompt = String(data.get("prompt") || "");
    const rubric = event.currentTarget.elements.rubric?.files?.[0];
    if (rubric && /\.(txt|md)$/i.test(rubric.name)) prompt = `${prompt}\n\n${await rubric.text()}`;
    const decoder = decodeAssignment({ prompt, dueDate: assignment?.due_date || isoDay(), course, documents: state.documents });
    await withFeedback(async () => {
      await saveDecoderRun(state.user, decoder);
      state.decoder = decoder;
      state.ui.status = "Assignment decoded.";
    });
    render();
  });
  document.querySelectorAll("[data-action='decoder-to-tasks']").forEach((button) => {
    button.onclick = async () => {
      if (!state.decoder) return;
      await withFeedback(async () => {
        await addTasks(
          state.user.id,
          state.decoder.checklist.map((item, index) => ({
            id: uid("task"),
            course_id: state.decoder.course_id,
            title: item,
            due_date: state.decoder.due_date,
            priority: index === 0 ? "High" : "Medium",
            completed: false,
            source_type: "decoder",
            source_id: state.decoder.id,
          }))
        );
        await hydrateWorkspace();
        window.location.hash = "#/today";
        state.ui.status = "Checklist added to your plan.";
      });
      render();
    };
  });
  document.getElementById("study-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await handleStudyQuestion(String(data.get("question") || ""));
    event.currentTarget.reset();
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.onclick = async () => {
      await handleStudyQuestion(button.dataset.prompt);
    };
  });
  document.querySelectorAll("[data-study-mode]").forEach((button) => {
    button.onclick = () => {
      state.ui.studyMode = button.dataset.studyMode;
      render();
    };
  });
  bindDraftInputs();
}

function bindDraftInputs() {
  document.querySelectorAll("[data-draft-top]").forEach((input) => {
    input.addEventListener("input", () => {
      const draft = selectedDraft();
      if (!draft) return;
      draft.course_draft = { ...draft.course_draft, [input.dataset.draftTop]: input.value };
    });
  });
  document.querySelectorAll("[data-draft-policy]").forEach((input) => {
    input.addEventListener("input", () => {
      const draft = selectedDraft();
      if (!draft) return;
      draft.course_draft = {
        ...draft.course_draft,
        policies: { ...(draft.course_draft?.policies || {}), [input.dataset.draftPolicy]: input.value },
      };
    });
  });
  document.querySelectorAll("[data-draft-row]").forEach((input) => {
    input.addEventListener("input", () => updateDraftRow(input.dataset.draftRow, input.dataset.rowId, input.dataset.field, input.value));
  });
  document.querySelectorAll("[data-toggle-draft-row]").forEach((button) => {
    button.onclick = () => {
      toggleDraftRow(button.dataset.toggleDraftRow, button.dataset.rowId);
      render();
    };
  });
  document.querySelectorAll("[data-add-draft-row]").forEach((button) => {
    button.onclick = () => {
      addDraftRow(button.dataset.addDraftRow);
      render();
    };
  });
  document.querySelectorAll("[data-action='save-draft']").forEach((button) => {
    button.onclick = async () => {
      const draft = selectedDraft();
      if (!draft) return;
      await withFeedback(async () => {
        await saveDraftReview(state.user.id, draft);
        await hydrateWorkspace();
        state.ui.status = "Changes saved.";
      });
      render();
    };
  });
  document.querySelectorAll("[data-action='confirm-draft']").forEach((button) => {
    button.onclick = async () => {
      const draft = selectedDraft();
      if (!draft) return;
      await withFeedback(async () => {
        await confirmDraftImport(state.user, draft, state.courses);
        await hydrateWorkspace();
        state.ui.route = "today";
        state.ui.selectedDraftId = "";
        state.ui.status = `${draft.course_draft?.code || "Course"} added to your plan.`;
      });
      render();
    };
  });
}

function updateDraftRow(type, rowId, field, value) {
  const draft = selectedDraft();
  if (!draft) return;
  const row = draftListByType(draft, type).find((item) => item.id === rowId);
  if (!row) return;
  row[field] = field === "weight" ? Number(value || 0) : value;
}

function toggleDraftRow(type, rowId) {
  const draft = selectedDraft();
  if (!draft) return;
  const row = draftListByType(draft, type).find((item) => item.id === rowId);
  if (row) row.deleted = !row.deleted;
}

function addDraftRow(type) {
  const draft = selectedDraft();
  if (!draft) return;
  const source_document_ids = draft.document_ids || [];
  if (type === "assignment") {
    draft.assignments.unshift({ id: uid("draft-assignment"), title: "", due_date: "", weight: 0, estimated_minutes: 90, priority: "Medium", confidence: "low", source_document_ids, deleted: false });
  } else if (type === "exam") {
    draft.exams.unshift({ id: uid("draft-exam"), title: "", exam_date: "", weight: 0, confidence: "low", source_document_ids, deleted: false });
  } else {
    draft.readings.unshift({ id: uid("draft-reading"), title: "", due_date: "", pages: "", confidence: "low", source_document_ids, deleted: false });
  }
}

function draftListByType(draft, type) {
  if (type === "assignment") return draft.assignments;
  if (type === "exam") return draft.exams;
  return draft.readings;
}

function reviewRowByType(draft, type, rowId) {
  if (!draft) return null;
  if (type === "assignment") return (draft.assignments || []).find((item) => item.id === rowId);
  if (type === "exam") return (draft.exams || []).find((item) => item.id === rowId);
  if (type === "reading") return (draft.readings || []).find((item) => item.id === rowId);
  if (type === "grading") return (draft.course_draft?.grading_weights || []).find((item) => item.id === rowId);
  return null;
}

function setReviewRowValue(type, rowId, field, value) {
  const draft = selectedDraft();
  const row = reviewRowByType(draft, type, rowId);
  if (!row) return;
  row[field] = value;
  if (field === "title" && type === "grading") row.label = value;
}

async function handleStudyQuestion(question) {
  if (!question) return;
  await withFeedback(async () => {
    const selectedCourseId = state.ui.selectedCourseId || null;
    const answer = answerGroundedQuestion({ question, documents: state.documents, assignments: state.assignments, selectedCourseId });
    await saveChatMessage(state.user.id, selectedCourseId, "user", question, [], "high");
    await saveChatMessage(state.user.id, selectedCourseId, "assistant", answer.message, answer.citations, answer.confidence);
    state.chatMessages = await loadChatMessages(state.user.id, selectedCourseId);
    state.ui.status = answer.notFound ? "No matching source found." : "Answer grounded in your materials.";
  });
  render();
}

async function withFeedback(fn) {
  try {
    clearStatus();
    await fn();
  } catch (error) {
    state.ui.error = error.message || "Something went wrong.";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processCourseFiles(files) {
  if (!files.length) return;
  await withFeedback(async () => {
    for (const step of uploadSteps) {
      state.ui.uploadStage = step;
      render();
      await delay(120);
    }
    const parsed = await parseCourseFiles(files);
    await uploadAndCreateDrafts(state.user, parsed);
    await hydrateWorkspace();
    state.ui.uploadStage = "";
    state.ui.selectedDraftId = state.draftImports[0]?.id || "";
    state.ui.status = "Your course file is ready to review.";
  });
}

function sampleSyllabusText() {
  return `
BIO 142 Biology of Human Systems
Course Title: Biology of Human Systems
Instructor: Dr. Maya Chen
Office Hours: Tuesdays 2:00-4:00 PM, Science Hall 214
Required Materials: OpenStax Biology 2e, weekly lecture slides, lab notebook.
Late Policy: Assignments lose 10% per day late unless an extension is approved before the deadline.
Attendance Policy: Lab attendance is required. More than two missed labs may lower the final grade.

Grading
Weekly Reading Quizzes 10%
Lab Reports 20%
Midterm Exam 20%
Final Exam 25%
Research Project 25%

Schedule
Reading Chapter 3 Cell Structure due ${sampleDate(2)}
Lab Report 1 due ${sampleDate(5)} 8%
Quiz: Cells and Membranes on ${sampleDate(7)} 5%
Reading Chapter 5 Energy and Enzymes due ${sampleDate(9)}
Midterm Exam on ${sampleDate(14)} 20%
Research Project Proposal due ${sampleDate(18)} 10%
Lab Report 2 due ${sampleDate(24)} 12%
Final Research Project due ${sampleDate(34)} 25%
Final Exam on ${sampleDate(42)} 25%
`;
}

function sampleDate(offset) {
  const [year, month, day] = addDays(new Date(), offset).split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

function sourceLabel(draft) {
  const document = state.documents.find((item) => draft.document_ids?.includes(item.id));
  return document ? document.file_name : "Uploaded file";
}

function sourceLine(draft) {
  const document = state.documents.find((item) => draft.document_ids?.includes(item.id));
  const excerpt = document?.snippets?.[0] || document?.preview || "Source excerpt will appear when text is available.";
  return `<span class="source-inline">${escapeHtml(sourceLabel(draft))}: ${escapeHtml(excerpt)}</span>`;
}

function sourceLabelForRow(row) {
  const document = state.documents.find((item) => row.source_document_ids?.includes(item.id));
  return document ? document.file_name : "Uploaded file";
}

function sourceExcerptForRow(row) {
  if (row.source_excerpt) return row.source_excerpt;
  const document = state.documents.find((item) => row.source_document_ids?.includes(item.id));
  if (!document) return "Source excerpt unavailable.";
  const titleToken = String(row.title || "").split(/\W+/).find((token) => token.length > 4)?.toLowerCase();
  return document.snippets?.find((snippet) => titleToken && snippet.toLowerCase().includes(titleToken)) || document.preview || "";
}

function applyReviewDefaults(draft) {
  [...(draft.assignments || []), ...(draft.exams || []), ...(draft.readings || [])].forEach((row) => {
    if (typeof row.approved === "undefined") row.approved = isCleanReviewRow(row, row.exam_date ? "exam" : row.pages !== undefined ? "reading" : "assignment");
  });
  (draft.course_draft?.grading_weights || []).forEach((row) => {
    if (typeof row.approved === "undefined") row.approved = true;
    if (!row.confidence) row.confidence = "high";
  });
}

function isCleanReviewRow(row, type) {
  const date = type === "exam" ? row.exam_date : row.due_date;
  if (row.deleted || !row.title || row.confidence === "low") return false;
  if ((type === "assignment" || type === "exam" || type === "reading") && !date) return false;
  if (probableLogistics(row.title)) return false;
  return true;
}

function reviewItemsForDraft(draft, tab = "deadlines") {
  const details = [
    detailItem(draft, "code", "Course code", draft.course_draft?.code),
    detailItem(draft, "title", "Course title", draft.course_draft?.title),
    detailItem(draft, "professor", "Professor", draft.course_draft?.professor),
    detailItem(draft, "office_hours", "Office hours", draft.course_draft?.office_hours),
  ];
  const deadlines = (draft.assignments || []).map((row) => rowItem(row, "assignment", "Deadline", "due_date", "weight"));
  const exams = (draft.exams || []).map((row) => rowItem(row, "exam", "Exam", "exam_date", "weight"));
  const readings = (draft.readings || []).map((row) => rowItem(row, "reading", "Reading", "due_date", ""));
  const grading = (draft.course_draft?.grading_weights || []).map((row) => ({
    id: row.id,
    type: "grading",
    title: row.label,
    date: "",
    weight: row.weight,
    kind: "grading",
    kindLabel: "Grading",
    confidence: row.confidence || "high",
    confidenceLabel: `${row.confidence || "high"} confidence`,
    approved: row.approved !== false,
    editable: false,
    sourceTitle: sourceLabel(draft),
    sourceExcerpt: sourceLineText(draft),
  }));
  const policies = [
    policyItem(draft, "late_policy", "Late policy"),
    policyItem(draft, "attendance_policy", "Attendance policy"),
    policyItem(draft, "required_materials", "Required materials"),
  ].filter((item) => item.title);
  const all = { details, deadlines, exams, readings, grading, policies };
  const flagged = Object.values(all)
    .flat()
    .filter((item) => item.reason || item.approved === false || item.confidence === "low");
  return tab === "flagged" ? flagged : all[tab] || deadlines;
}

function detailItem(draft, field, labelText, value) {
  return {
    id: `detail-${field}`,
    type: "detail",
    field,
    title: value || `${labelText} missing`,
    date: "",
    weight: "",
    kind: "detail",
    kindLabel: labelText,
    confidence: value ? "high" : "low",
    confidenceLabel: `${value ? "high" : "low"} confidence`,
    approved: Boolean(value),
    editable: false,
    sourceTitle: sourceLabel(draft),
    sourceExcerpt: sourceLineText(draft),
    reason: value ? "" : "Missing value",
  };
}

function policyItem(draft, field, labelText) {
  const value = draft.course_draft?.policies?.[field] || "";
  return {
    id: `policy-${field}`,
    type: "policy",
    field,
    title: value,
    date: "",
    weight: "",
    kind: "policy",
    kindLabel: labelText,
    confidence: value ? "medium" : "low",
    confidenceLabel: `${value ? "medium" : "low"} confidence`,
    approved: Boolean(value),
    editable: false,
    sourceTitle: sourceLabel(draft),
    sourceExcerpt: value || sourceLineText(draft),
    reason: value ? "" : "Missing value",
  };
}

function rowItem(row, type, kindLabel, dateField, weightField) {
  const date = row[dateField] || "";
  const reason = !row.title
    ? "Missing title"
    : !date
      ? "Missing date"
      : row.confidence === "low"
        ? "Low confidence"
        : probableLogistics(row.title)
          ? "Looks like course logistics"
          : "";
  return {
    id: row.id,
    type,
    title: row.title || "",
    date,
    dateField,
    weight: weightField ? Number(row[weightField] || 0) : "",
    weightField,
    kind: type,
    kindLabel,
    confidence: row.confidence || "medium",
    confidenceLabel: `${row.confidence || "medium"} confidence`,
    approved: row.approved !== false,
    deleted: row.deleted,
    editable: true,
    sourceTitle: sourceLabelForRow(row),
    sourceExcerpt: sourceExcerptForRow(row),
    reason,
  };
}

function reviewStats(draft) {
  const items = Object.fromEntries(["details", "deadlines", "exams", "readings", "grading", "policies", "flagged"].map((tab) => [tab, reviewItemsForDraft(draft, tab)]));
  const actionable = [...items.deadlines, ...items.exams, ...items.readings, ...items.grading];
  return {
    details: items.details.length,
    deadlines: items.deadlines.filter((item) => !item.deleted).length,
    exams: items.exams.filter((item) => !item.deleted).length,
    readings: items.readings.filter((item) => !item.deleted).length,
    grading: items.grading.length,
    policies: items.policies.length,
    flagged: items.flagged.length + (draft.warnings || []).length,
    approved: actionable.filter((item) => item.approved !== false && !item.deleted).length,
    needsReview: actionable.filter((item) => item.approved === false || item.reason).length,
    missingDates: actionable.filter((item) => item.reason === "Missing date").length,
  };
}

function selectedReviewItem(draft) {
  if (!state.ui.selectedReviewItemId) return null;
  return reviewItemsForDraft(draft, state.ui.reviewTab).find((item) => item.id === state.ui.selectedReviewItemId && item.type === state.ui.selectedReviewItemType) || reviewItemsForDraft(draft, "flagged").find((item) => item.id === state.ui.selectedReviewItemId && item.type === state.ui.selectedReviewItemType) || null;
}

function confidenceClass(confidence = "medium") {
  if (confidence === "high") return "high";
  if (confidence === "low") return "low";
  return "medium";
}

function suggestedCorrection(item) {
  if (item.reason === "Missing date") return "Keep flagged until a due date is added.";
  if (item.reason === "Looks like course logistics") return "Move to policies or course details.";
  if (item.confidence === "low") return "Verify against source before approving.";
  return "Looks ready to approve.";
}

function probableLogistics(value = "") {
  return /(required materials?|late policy|attendance policy|office hours?|instructor|professor|course title|grading)\b/i.test(value);
}

function sourceLineText(draft) {
  const document = state.documents.find((item) => draft.document_ids?.includes(item.id));
  return document?.snippets?.[0] || document?.preview || "";
}

function renderTaskRow(task) {
  const course = state.courses.find((item) => item.id === task.course_id);
  const urgency = dateState(task.due_date);
  const impact = impactForTask(task);
  return `
    <div class="task-card ${task.completed ? "complete" : ""} ${task.in_progress ? "in-progress" : ""}">
      <input type="checkbox" data-task-toggle="${task.id}" ${task.completed ? "checked" : ""} />
      <div class="task-main">
        <strong>${escapeHtml(task.title)}</strong>
        <p class="list-subcopy">${escapeHtml(course?.code || "General")} · ${task.due_date ? formatLong(task.due_date) : "No due date"} · ${escapeHtml(impact)}</p>
      </div>
      <span class="time-pill">${estimatedTime(task)}</span>
      <span class="urgency-chip ${urgency.key}">${task.in_progress ? "In progress" : escapeHtml(urgency.label)}</span>
      <button class="ghost-button compact-action" data-action="start-task" data-task-id="${task.id}">Start</button>
      <button class="ghost-button compact-action" data-action="open-task" data-task-id="${task.id}">Open</button>
    </div>
  `;
  return `
    <label class="task-card ${task.completed ? "complete" : ""}">
      <input type="checkbox" data-task-toggle="${task.id}" ${task.completed ? "checked" : ""} />
      <div class="task-main"><strong>${escapeHtml(task.title)}</strong><p class="list-subcopy">${escapeHtml(course?.code || "General")} · ${task.due_date ? formatLong(task.due_date) : "No due date"} · ${impact}</p></div>
      <span class="urgency-chip ${urgency.key}">${escapeHtml(urgency.label)}</span>
    </label>
  `;
}

function renderQueueRow(item) {
  const course = state.courses.find((courseItem) => courseItem.id === item.course_id);
  const urgency = dateState(item.due_date);
  return `
    <div class="queue-row ${item.completed ? "complete" : ""} ${item.in_progress ? "in-progress" : ""}">
      <input class="queue-check" type="checkbox" data-task-toggle="${item.id}" ${item.completed ? "checked" : ""} />
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(course?.code || "Course")} · ${item.due_date ? formatLong(item.due_date) : "No due date"} · ${escapeHtml(impactForTask(item))}</p>
      </div>
      <span class="time-pill">${estimatedTime(item)}</span>
      <span class="urgency-chip ${urgency.key}">${item.in_progress ? "In progress" : escapeHtml(urgency.label)}</span>
      <button class="ghost-button compact-action" data-action="start-task" data-task-id="${item.id}">Start</button>
      <button class="ghost-button compact-action" data-action="break-task" data-task-id="${item.id}">Break</button>
      <button class="ghost-button compact-action" data-action="open-task" data-task-id="${item.id}">Open</button>
    </div>
  `;
  return `
    <div class="queue-row">
      <span class="queue-check"></span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(course?.code || "Course")} · ${item.due_date ? formatLong(item.due_date) : "No due date"} · ${impactForTask(item)}</p>
      </div>
      <span class="time-pill">${estimatedTime(item)}</span>
      <span class="urgency-chip ${urgency.key}">${escapeHtml(urgency.label)}</span>
      <button class="ghost-button">Start</button>
    </div>
  `;
}

function renderDeadlineRow(item, dateField) {
  const course = state.courses.find((courseItem) => courseItem.id === item.course_id);
  const urgency = dateState(item[dateField]);
  const impact = Number(item.weight || 0) >= 15 ? "High impact" : `${item.weight || 0}% of grade`;
  return `
    <div class="deadline-card">
      <span class="urgency-chip ${urgency.key}">${escapeHtml(urgency.label)}</span>
      <div><strong>${escapeHtml(item.title)}</strong><p class="list-subcopy">${escapeHtml(course?.code || "Course")} · ${dateField === "exam_date" ? "exam" : "due"} ${formatLong(item[dateField])}</p></div>
      <span class="metric-pill">${escapeHtml(impact)}</span>
    </div>
  `;
}

function renderNextBestAction(item) {
  if (!item) {
    return `<div class="next-action-card"><p class="eyebrow">Next best action</p><h3>Upload a syllabus to build your plan.</h3><p>No approved work yet. Add one course file and Class Compass will create today’s recommended actions.</p><button class="primary-button" data-action="go-upload">Build my semester plan</button></div>`;
  }
  const course = state.courses.find((courseItem) => courseItem.id === item.course_id);
  const urgency = dateState(item.due_date);
  return `<div class="next-action-card">
    <p class="eyebrow">Next best action</p>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(urgency.detail)} · ${escapeHtml(course?.code || "Course")} · ${escapeHtml(impactForTask(item))}</p>
    <small>Why this? It is the nearest confirmed task with the strongest urgency and grade impact.</small>
    <div class="button-row"><button class="primary-button" data-action="start-task" data-task-id="${item.id}">Start 25 min</button><button class="secondary-button" data-action="break-task" data-task-id="${item.id}">Break into steps</button><button class="ghost-button" data-action="open-task" data-task-id="${item.id}">Open</button></div>
  </div>`;
  return `<div class="next-action-card">
    <p class="eyebrow">Next best action</p>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(urgency.detail)} · ${escapeHtml(course?.code || "Course")} · ${impactForTask(item)}</p>
    <small>Why this? It is the nearest confirmed item with the strongest urgency and grade impact.</small>
    <div class="button-row"><button class="primary-button">Start 25 min</button><button class="secondary-button">Break into steps</button><button class="ghost-button" data-route="assignments">Open</button></div>
  </div>`;
}

function renderRiskCard(title, copy, icon, route = "calendar") {
  return `<button class="risk-card" data-risk-route="${escapeHtml(route)}">${navIcon(icon)}<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy || "No deadline pileups this week.")}</p></div><span>Open</span></button>`;
}

function bestNextAction(snapshot) {
  return rankedActionTasks(snapshot)[0];
  return [...snapshot.todayTasks, ...snapshot.dueSoon]
    .filter((item) => item.due_date)
    .sort((a, b) => {
      const aState = dateState(a.due_date);
      const bState = dateState(b.due_date);
      if (aState.rank !== bState.rank) return aState.rank - bState.rank;
      const impactDelta = Number(b.weight || 0) - Number(a.weight || 0);
      if (impactDelta !== 0) return impactDelta;
      return new Date(a.due_date) - new Date(b.due_date);
    })[0];
}

function buildTodayQueue(snapshot, nextAction) {
  const seeded = nextAction ? [nextAction] : [];
  const ranked = rankedActionTasks(snapshot);
  const ids = new Set();
  return [...seeded, ...ranked].filter((item) => {
    const key = item.id || `${item.title}-${item.due_date}`;
    if (ids.has(key)) return false;
    ids.add(key);
    return true;
  });
}

function rankedActionTasks(snapshot) {
  const taskWeight = (task) => {
    const assignment = task.source_type === "assignment" ? state.assignments.find((item) => item.id === task.source_id) : null;
    return Number(assignment?.weight || task.weight || 0);
  };
  return state.tasks
    .filter((task) => !task.completed)
    .sort((a, b) => {
      const aState = dateState(a.due_date);
      const bState = dateState(b.due_date);
      if (aState.rank !== bState.rank) return aState.rank - bState.rank;
      const impactDelta = taskWeight(b) - taskWeight(a);
      if (impactDelta !== 0) return impactDelta;
      if (String(a.priority).toLowerCase() === "high" && String(b.priority).toLowerCase() !== "high") return -1;
      if (String(b.priority).toLowerCase() === "high" && String(a.priority).toLowerCase() !== "high") return 1;
      return new Date(a.due_date || "2999-01-01") - new Date(b.due_date || "2999-01-01");
    });
}

function recommendedActionTitle(item) {
  if (/exam|quiz|test/i.test(item.title)) return `Review for ${item.title}`;
  if (/reading|chapter|article/i.test(item.title)) return `Read ${item.title}`;
  return `Start ${item.title}`;
}

function estimatedTime(item) {
  const minutes = Number(item.estimated_minutes || 25);
  if (minutes <= 30) return `${minutes} min`;
  return "25 min";
}

function impactForTask(item) {
  const source =
    item.source_id && item.source_type === "assignment"
      ? state.assignments.find((assignment) => assignment.id === item.source_id)
      : item;
  const weight = Number(source?.weight || item.weight || 0);
  if (weight >= 15) return `${weight}% of grade · high impact`;
  if (String(item.priority || "").toLowerCase() === "high") return "Heavy lift";
  return "Estimated 25 min";
}

function dateState(date) {
  if (!date) return { key: "quick", label: "Quick task", detail: "No due date", rank: 5 };
  const diff = daysUntil(date);
  if (diff < 0) return { key: "overdue", label: "Overdue", detail: `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"}`, rank: 0 };
  if (diff === 0) return { key: "due-today", label: "Due today", detail: "Due today", rank: 1 };
  if (diff <= 2) return { key: "due-soon", label: "Due soon", detail: `Due in ${diff} day${diff === 1 ? "" : "s"}`, rank: 2 };
  if (diff <= 7) return { key: "study", label: "Study recommended", detail: `Due in ${diff} days`, rank: 3 };
  return { key: "quick", label: "Upcoming", detail: `Due in ${diff} days`, rank: 4 };
}

function daysUntil(date) {
  const today = new Date(isoDay());
  return Math.ceil((new Date(date) - today) / 86400000);
}

function shortEventName(title = "") {
  return String(title)
    .replace(/^(prep|draft|review|start|read)\s+/i, "")
    .replace(/chapter\s+\d+\s*/i, "Reading ")
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
}

function labelTab(tab) {
  return {
    overview: "Overview",
    assignments: "Assignments",
    materials: "Materials",
    study: "Study",
    policies: "Policies",
  }[tab] || "Overview";
}

function renderMaterialRow(document) {
  const kind = document.kind || document.sourceType || "material";
  const excerpt = document.preview || document.snippets?.[0] || "Open this source from course materials.";
  return `<div class="material-row">
    <div><strong>${escapeHtml(document.file_name || "Course material")}</strong><span>${escapeHtml(kind)} · Uploaded</span></div>
    <button class="ghost-button compact-action" data-source-title="${escapeHtml(document.file_name || "Course material")}" data-source-excerpt="${escapeHtml(excerpt)}">Open</button>
    <button class="ghost-button compact-action" data-prompt="Ask about ${escapeHtml(document.file_name || "this source")}">Ask</button>
  </div>`;
}

function taskSteps(task = {}) {
  const title = String(task.title || "");
  if (/lab|report/i.test(title)) {
    return ["Open the rubric or source", "Write the hypothesis", "Add the data table", "Draft the results section", "Review the submission checklist"];
  }
  if (/exam|quiz|test/i.test(title)) {
    return ["List the tested topics", "Review source notes", "Create practice questions", "Do one 20-minute quiz block", "Review weak spots"];
  }
  if (/read|chapter|article/i.test(title)) {
    return ["Open the reading", "Skim headings and figures", "Annotate key concepts", "Write a 3-sentence summary"];
  }
  return ["Open the instructions", "Identify the deliverable", "Gather required materials", "Complete the first pass", "Review before submitting"];
}

function sourceForTask(task = {}) {
  let sourceIds = [];
  if (task.source_type === "assignment") {
    sourceIds = state.assignments.find((item) => item.id === task.source_id)?.source_document_ids || [];
  } else if (task.source_type === "exam") {
    sourceIds = state.exams.find((item) => item.id === task.source_id)?.source_document_ids || [];
  } else if (task.source_type === "reading") {
    sourceIds = state.readings.find((item) => item.id === task.source_id)?.source_document_ids || [];
  }
  const document =
    state.documents.find((item) => sourceIds.includes(item.id)) ||
    state.documents.find((item) => item.course_id && item.course_id === task.course_id);
  if (!document) return null;
  const token = String(task.title || "").split(/\W+/).find((part) => part.length > 4)?.toLowerCase();
  const excerpt = document.snippets?.find((snippet) => token && snippet.toLowerCase().includes(token)) || document.preview || document.snippets?.[0] || "";
  return { title: document.file_name || "Course source", excerpt };
}

function renderGradeMap(course) {
  const weights = course.grading_weights || [];
  if (!weights.length) return renderCompactEmpty("No grade weights yet", "Approve or add grading weights to see what matters most.");
  return `<div class="grade-map">${weights
    .slice(0, 6)
    .map((item) => `<div><span style="width:${Math.min(100, Number(item.weight || 0))}%"></span><strong>${escapeHtml(item.label)}</strong><em>${item.weight}%</em></div>`)
    .join("")}</div>`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function renderCourseListRow(course) {
  const assignmentCount = state.assignments.filter((item) => item.course_id === course.id).length;
  return `
    <button class="course-row" data-select-course="${course.id}">
      <div><strong><span class="course-dot" style="background:${escapeHtml(course.color || "#1f6feb")}"></span>${escapeHtml(course.code)} - ${escapeHtml(course.title)}</strong><p class="list-subcopy">${escapeHtml(course.professor || "Professor not added")} - ${escapeHtml(course.office_hours || "Office hours not added")}</p></div>
      <span class="minimal-note">${assignmentCount} assignments</span>
    </button>
  `;
}

function renderPolicyRow(labelText, value) {
  return value
    ? `<div class="quiet-item"><strong>${escapeHtml(labelText)}</strong><span class="list-subcopy">${escapeHtml(value)}</span></div>`
    : `<div class="quiet-item"><strong>${escapeHtml(labelText)}</strong><span class="list-subcopy">Not added yet.</span></div>`;
}

function renderDecoderList(title, items = []) {
  return `<div class="list-row"><strong>${escapeHtml(title)}</strong><div class="checklist">${items.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div></div>`;
}

function renderCitationBlock(citations = []) {
  return `<div class="list-row"><strong>Source citations</strong><div class="citation-list">${renderCitationRows(citations) || `<p class="list-subcopy">No matching course source found yet.</p>`}</div></div>`;
}

function renderCitationRows(citations = []) {
  return citations.map((citation) => `<button class="citation-row" data-source-title="${escapeHtml(citation.source_file)}" data-source-excerpt="${escapeHtml(citation.excerpt || citation.source_section || "")}"><span>${escapeHtml(citation.source_file)}</span><span class="minimal-note">${escapeHtml(citation.excerpt || citation.source_section || "")}</span></button>`).join("");
}

function renderChatBubble(message) {
  return `<div class="chat-bubble ${message.role}"><strong>${message.role === "assistant" ? "Class Compass" : "You"}</strong><p class="body-copy">${escapeHtml(message.content)}</p>${message.citations?.length ? `<div class="citation-list">${renderCitationRows(message.citations)}</div>` : ""}</div>`;
}

function renderEmpty(title, copy) {
  return `<div class="empty-state"><h4>${escapeHtml(title)}</h4><p class="empty-copy">${escapeHtml(copy)}</p></div>`;
}

function renderCompactEmpty(title, copy) {
  return `<div class="compact-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
}

function studyLabel(mode) {
  return {
    guide: "Study guide",
    flashcards: "Flashcards",
    quiz: "Quiz me",
    explain: "Explain this",
    exam: "Make exam plan",
  }[mode];
}

function draftConfidence(draft) {
  const values = [
    ...(draft.assignments || []),
    ...(draft.exams || []),
    ...(draft.readings || []),
  ].map((item) => ({ high: 96, medium: 82, low: 58 }[item.confidence] || 75));
  if (!values.length) return 72;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function navIcon(name) {
  const icons = {
    today: "M5 12h14M12 5v14",
    courses: "M4 6h16M4 12h16M4 18h10",
    calendar: "M7 3v4M17 3v4M4 8h16M6 5h12v15H6z",
    assignments: "M6 4h9l3 3v13H6zM14 4v4h4",
    study: "M4 18c3-2 5-2 8 0 3-2 5-2 8 0V6c-3-2-5-2-8 0-3-2-5-2-8 0z",
    upload: "M12 17V5M7 10l5-5 5 5M5 19h14",
    settings: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2M18 12h2M12 4v2M12 18v2",
    search: "M10 5a5 5 0 104 8l4 4",
    risk: "M12 4l9 16H3zM12 9v5M12 17h.01",
    target: "M12 5a7 7 0 100 14 7 7 0 000-14zM12 9a3 3 0 100 6 3 3 0 000-6z",
    file: "M6 4h9l3 3v13H6zM14 4v4h4",
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.today}" /></svg>`;
}

function label(route) {
  return {
    today: "Today",
    courses: "Courses",
    calendar: "Calendar",
    assignments: "Assignments",
    study: "Study",
    upload: "Upload",
    settings: "Settings",
  }[route];
}

function pageTitle() {
  return {
    today: "Today's plan",
    courses: "Course command center",
    calendar: "Semester Map",
    assignments: "Assignment Decoder",
    study: "Study Mode",
    upload: "Upload syllabus",
    settings: "Settings",
  }[state.ui.route];
}
