import { buildAutoTasks, buildPlannerSnapshot, buildWeeklyReset } from "./planner.js";
import { isoDay, uid } from "./utils.js";

const STORAGE_KEY = "class-compass-local-workspace-v3";
const LOCAL_USER = {
  id: "local-student",
  email: "student@classcompass.local",
  is_anonymous: true,
};

function blankWorkspace() {
  return {
    profile: {
      id: LOCAL_USER.id,
      email: LOCAL_USER.email,
      first_name: "",
      school: "",
      term: "Current term",
      energy_mode: "Balanced",
    },
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
  };
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankWorkspace();
    return { ...blankWorkspace(), ...JSON.parse(raw) };
  } catch {
    return blankWorkspace();
  }
}

function writeStore(workspace) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

export async function getSession() {
  return { user: LOCAL_USER };
}

export async function signInAnonymously() {
  return { user: LOCAL_USER };
}

export async function signOut() {
  writeStore(blankWorkspace());
}

export async function ensureProfile(_user, patch = {}) {
  const workspace = readStore();
  workspace.profile = {
    ...workspace.profile,
    id: LOCAL_USER.id,
    email: LOCAL_USER.email,
    ...patch,
  };
  writeStore(workspace);
}

export async function loadWorkspace() {
  const workspace = readStore();
  const snapshot = buildPlannerSnapshot({
    assignments: workspace.assignments,
    exams: workspace.exams,
    tasks: workspace.tasks,
    courses: workspace.courses,
  });
  return {
    profile: workspace.profile,
    courses: workspace.courses,
    documents: workspace.documents,
    draftImports: workspace.draftImports,
    assignments: workspace.assignments,
    exams: workspace.exams,
    readings: workspace.readings,
    tasks: workspace.tasks,
    weeklyReset: workspace.weeklyReset || buildWeeklyReset(snapshot, workspace.courses),
    decoder: workspace.decoder,
    snapshot,
  };
}

export async function uploadAndCreateDrafts(_user, parsed) {
  const workspace = readStore();
  const documents = parsed.documents.map((document) => ({
    id: document.id,
    user_id: LOCAL_USER.id,
    course_id: null,
    draft_import_id: null,
    file_name: document.file_name,
    kind: document.kind,
    storage_path: `local/${document.file_name}`,
    mime_type: document.mime_type,
    source_type: document.source_type,
    extraction_status: document.extraction_status,
    warnings: document.warnings || [],
    extracted_text: document.extracted_text || "",
    snippets: document.snippets || [],
    preview: document.preview || "",
    confidence: document.extraction_status === "parsed" ? "medium" : "low",
  }));
  const drafts = parsed.drafts.map((draft) => ({
    ...draft,
    user_id: LOCAL_USER.id,
    linked_course_id: null,
    status: "draft",
  }));
  workspace.documents.unshift(...documents);
  workspace.draftImports.unshift(...drafts);
  writeStore(workspace);
  return { documents, drafts };
}

export async function saveDraftReview(_userId, draft) {
  const workspace = readStore();
  workspace.draftImports = workspace.draftImports.map((item) =>
    item.id === draft.id ? { ...draft, status: "saved", updated_at: new Date().toISOString() } : item
  );
  writeStore(workspace);
}

export async function confirmDraftImport(_user, draft, existingCourses = []) {
  const workspace = readStore();
  let course =
    existingCourses.find((item) => item.id === draft.linked_course_id) ||
    workspace.courses.find(
      (item) =>
        item.code?.toLowerCase() === draft.course_draft?.code?.toLowerCase() ||
        item.title?.toLowerCase() === draft.course_draft?.title?.toLowerCase()
    );

  if (!course) {
    course = {
      id: uid("course"),
      user_id: LOCAL_USER.id,
      code: draft.course_draft?.code || "COUR 101",
      title: draft.course_draft?.title || "Untitled Course",
      professor: draft.course_draft?.professor || "",
      office_hours: draft.course_draft?.office_hours || "",
      grading_weights: (draft.course_draft?.grading_weights || []).filter((item) => item.approved !== false),
      policies: draft.course_draft?.policies || {},
      color: pickCourseColor(workspace.courses.length),
      created_at: new Date().toISOString(),
    };
    workspace.courses.push(course);
  } else {
    course = {
      ...course,
      code: draft.course_draft?.code || course.code,
      title: draft.course_draft?.title || course.title,
      professor: draft.course_draft?.professor || course.professor,
      office_hours: draft.course_draft?.office_hours || course.office_hours,
      grading_weights: draft.course_draft?.grading_weights?.length ? draft.course_draft.grading_weights.filter((item) => item.approved !== false) : course.grading_weights,
      policies: { ...(course.policies || {}), ...(draft.course_draft?.policies || {}) },
    };
    workspace.courses = workspace.courses.map((item) => (item.id === course.id ? course : item));
  }

  workspace.documents = workspace.documents.map((document) =>
    draft.document_ids?.includes(document.id)
      ? { ...document, course_id: course.id, draft_import_id: draft.id }
      : document
  );

  const assignments = draft.assignments
    .filter((item) => !item.deleted && item.title && item.approved !== false)
    .map((item) => ({
      id: uid("assignment"),
      user_id: LOCAL_USER.id,
      course_id: course.id,
      title: item.title,
      due_date: item.due_date || null,
      weight: Number(item.weight || 0),
      estimated_minutes: Number(item.estimated_minutes || 90),
      priority: item.priority || "Medium",
      source_document_ids: item.source_document_ids || draft.document_ids,
    }));

  const exams = draft.exams
    .filter((item) => !item.deleted && item.title && item.approved !== false)
    .map((item) => ({
      id: uid("exam"),
      user_id: LOCAL_USER.id,
      course_id: course.id,
      title: item.title,
      exam_date: item.exam_date || null,
      weight: Number(item.weight || 0),
      source_document_ids: item.source_document_ids || draft.document_ids,
    }));

  const readings = draft.readings
    .filter((item) => !item.deleted && item.title && item.approved !== false)
    .map((item) => ({
      id: uid("reading"),
      user_id: LOCAL_USER.id,
      course_id: course.id,
      title: item.title,
      due_date: item.due_date || null,
      pages: item.pages || "",
      source_document_ids: item.source_document_ids || draft.document_ids,
    }));

  const newTasks = buildAutoTasks({ assignments, exams, readings }).map((task) => ({
    ...task,
    id: uid("task"),
    user_id: LOCAL_USER.id,
  }));

  workspace.assignments.push(...assignments);
  workspace.exams.push(...exams);
  workspace.readings.push(...readings);
  workspace.tasks.push(...newTasks);
  workspace.draftImports = workspace.draftImports.filter((item) => item.id !== draft.id);

  const snapshot = buildPlannerSnapshot({
    assignments: workspace.assignments,
    exams: workspace.exams,
    tasks: workspace.tasks,
    courses: workspace.courses,
  });
  workspace.weeklyReset = buildWeeklyReset(snapshot, workspace.courses);
  workspace.lastApprovedAt = new Date().toISOString();
  writeStore(workspace);
}

export async function saveDecoderRun(_user, decoder) {
  const workspace = readStore();
  workspace.decoder = {
    id: uid("decoder-run"),
    user_id: LOCAL_USER.id,
    course_id: decoder.course_id,
    due_date: decoder.due_date,
    prompt: decoder.prompt,
    result: decoder,
    created_at: new Date().toISOString(),
  };
  writeStore(workspace);
}

export async function addTasks(_userId, tasks) {
  const workspace = readStore();
  workspace.tasks.push(...tasks.map((task) => ({ ...task, user_id: LOCAL_USER.id })));
  writeStore(workspace);
}

export async function updateTask(_userId, taskId, patch) {
  const workspace = readStore();
  workspace.tasks = workspace.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
  writeStore(workspace);
}

export async function addSubtasks(_userId, parentTaskId, subtasks) {
  const workspace = readStore();
  const parent = workspace.tasks.find((task) => task.id === parentTaskId);
  if (!parent) return;
  const childTasks = subtasks.map((title, index) => ({
    id: uid("task"),
    user_id: LOCAL_USER.id,
    course_id: parent.course_id,
    title,
    due_date: parent.due_date || isoDay(),
    priority: index === 0 ? "High" : "Medium",
    completed: false,
    parent_task_id: parentTaskId,
    source_type: parent.source_type,
    source_id: parent.source_id,
  }));
  workspace.tasks = workspace.tasks.map((task) =>
    task.id === parentTaskId ? { ...task, subtasks: childTasks.map((item) => item.id) } : task
  );
  workspace.tasks.push(...childTasks);
  writeStore(workspace);
}

export async function completeTask(_userId, taskId) {
  const workspace = readStore();
  workspace.tasks = workspace.tasks.map((task) =>
    task.id === taskId ? { ...task, completed: true, in_progress: false, completed_at: new Date().toISOString() } : task
  );
  writeStore(workspace);
}

export async function toggleTask(_userId, taskId, completed) {
  const workspace = readStore();
  workspace.tasks = workspace.tasks.map((task) =>
    task.id === taskId ? { ...task, completed, in_progress: completed ? false : task.in_progress, completed_at: completed ? new Date().toISOString() : null } : task
  );
  writeStore(workspace);
}

export async function saveChatMessage(_userId, courseId, role, content, citations = [], confidence = "medium") {
  const workspace = readStore();
  workspace.chatMessages.push({
    id: uid("message"),
    user_id: LOCAL_USER.id,
    course_id: courseId,
    role,
    content,
    citations,
    confidence,
    created_at: new Date().toISOString(),
  });
  writeStore(workspace);
}

export async function loadChatMessages(_userId, courseId = null) {
  const workspace = readStore();
  return workspace.chatMessages.filter((message) => !courseId || message.course_id === courseId);
}

export async function saveProfile(_userId, patch) {
  const workspace = readStore();
  workspace.profile = { ...workspace.profile, ...patch };
  writeStore(workspace);
}

export function clearLocalWorkspace() {
  writeStore(blankWorkspace());
}

function pickCourseColor(index) {
  return ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0f766e"][index % 6];
}
