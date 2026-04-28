import { addDays, differenceInDays, isoDay } from "./utils.js";

export function buildPlannerSnapshot({ assignments, exams, tasks, courses }) {
  const dueSoon = [...assignments, ...exams.map((exam) => ({ ...exam, due_date: exam.exam_date, priority: exam.weight >= 20 ? "High" : "Medium" }))]
    .filter((item) => item.due_date)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 6);

  const highImpact = dueSoon
    .filter((item) => Number(item.weight || 0) >= 15)
    .slice(0, 4);

  const riskDays = [0, 1, 2, 3, 4, 5, 6]
    .map((offset) => {
      const date = addDays(new Date(), offset);
      const count = [...assignments, ...tasks, ...exams].filter((item) => (item.due_date || item.exam_date) === date).length;
      return { date, count };
    })
    .filter((item) => item.count >= 3);

  const nextActionByCourse = courses
    .map((course) => {
      const courseItems = dueSoon.filter((assignment) => assignment.course_id === course.id);
      if (!courseItems.length) return null;
      const nearest = courseItems[0];
      return {
        course,
        text: `${nearest.title} is next on ${nearest.due_date}. Start with a ${Number(nearest.estimated_minutes || 60) > 60 ? "25-minute outline block" : "20-minute review block"}.`,
      };
    })
    .filter(Boolean);

  return {
    dueSoon,
    highImpact,
    riskDays,
    nextActionByCourse,
    todayTasks: tasks
      .filter((task) => !task.completed && (!task.due_date || task.due_date <= isoDay()))
      .sort((a, b) => {
        const priorityScore = { High: 0, Medium: 1, Low: 2 };
        const priorityDelta = (priorityScore[a.priority] ?? 1) - (priorityScore[b.priority] ?? 1);
        if (priorityDelta !== 0) return priorityDelta;
        return String(a.due_date || "").localeCompare(String(b.due_date || ""));
      }),
  };
}

export function buildAutoTasks({ assignments, exams, readings }) {
  const assignmentTasks = assignments.flatMap((assignment) => {
    if (!assignment.due_date) return [];
    return [
      makeTask(assignment.course_id, `Prep ${assignment.title}`, addDays(assignment.due_date, -5), "Medium", "assignment", assignment.id),
      makeTask(assignment.course_id, `Draft ${assignment.title}`, addDays(assignment.due_date, -2), "High", "assignment", assignment.id),
      makeTask(assignment.course_id, `Review ${assignment.title}`, addDays(assignment.due_date, -1), "High", "assignment", assignment.id),
    ];
  });

  const examTasks = exams.flatMap((exam) => {
    if (!exam.exam_date) return [];
    return [
      makeTask(exam.course_id, `Map ${exam.title}`, addDays(exam.exam_date, -5), "Medium", "exam", exam.id),
      makeTask(exam.course_id, `Practice ${exam.title}`, addDays(exam.exam_date, -2), "High", "exam", exam.id),
      makeTask(exam.course_id, `Final review ${exam.title}`, addDays(exam.exam_date, -1), "High", "exam", exam.id),
    ];
  });

  const readingTasks = readings.flatMap((reading) => {
    if (!reading.due_date) return [];
    return [makeTask(reading.course_id, `Read ${reading.title}`, addDays(reading.due_date, -1), "Medium", "reading", reading.id)];
  });

  return [...assignmentTasks, ...examTasks, ...readingTasks];
}

function makeTask(courseId, title, dueDate, priority, sourceType, sourceId) {
  return {
    course_id: courseId,
    title,
    due_date: dueDate,
    priority,
    completed: false,
    source_type: sourceType,
    source_id: sourceId,
  };
}

export function buildWeeklyReset(snapshot, courses) {
  const nearestExam = snapshot.highImpact[0];
  const officeHoursCourse =
    nearestExam && courses.find((course) => course.id === nearestExam.course_id && course.office_hours);
  return {
    wins:
      snapshot.dueSoon.length > 0
        ? `${snapshot.dueSoon.length} confirmed item${snapshot.dueSoon.length === 1 ? "" : "s"} are due in the next seven days.`
        : "No confirmed deadlines are due in the next seven days.",
    risks:
      snapshot.riskDays.length > 0
        ? `Workload cluster detected on ${snapshot.riskDays[0].date}. Break that week apart early.`
        : "No major cluster detected yet.",
    high_impact:
      snapshot.highImpact.length > 0
        ? `${snapshot.highImpact[0].title} carries the highest near-term grade impact.`
        : "No high-impact graded work is confirmed yet.",
    office_hours_hint: officeHoursCourse
      ? `Use ${officeHoursCourse.office_hours} office hours for ${officeHoursCourse.code} before the high-impact deadline.`
      : "No office-hours reminder needed yet.",
  };
}

export function semesterWeeks({ assignments, exams, readings }) {
  const items = [
    ...assignments.map((item) => ({ ...item, type: "assignment", date: item.due_date })),
    ...exams.map((item) => ({ ...item, type: "exam", date: item.exam_date })),
    ...readings.map((item) => ({ ...item, type: "reading", date: item.due_date })),
  ].filter((item) => item.date);

  const grouped = new Map();
  items.forEach((item) => {
    const date = new Date(item.date);
    const start = addDays(date, -date.getDay());
    const bucket = grouped.get(start) || [];
    bucket.push(item);
    grouped.set(start, bucket);
  });

  return [...grouped.entries()]
    .sort(([a], [b]) => new Date(a) - new Date(b))
    .map(([start, weekItems]) => {
      const examsCount = weekItems.filter((item) => item.type === "exam").length;
      const highImpactCount = weekItems.filter((item) => Number(item.weight || 0) >= 15).length;
      const level = weekItems.length >= 4 || examsCount >= 2 ? "crunch" : weekItems.length >= 2 || highImpactCount ? "heavy" : weekItems.length === 1 ? "normal" : "calm";
      const levelLabel = { calm: "Calm", normal: "Normal", heavy: "Heavy", crunch: "Crunch week" }[level];
      const date = new Date(`${start}T00:00:00`);
      const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return {
        start,
        label: `Week of ${label}`,
        levelLabel,
        items: weekItems,
        level,
        summary:
          level === "crunch"
            ? "Crunch week: deadlines cluster here."
            : level === "heavy"
              ? "Heavy week: start early."
              : "Calm week: keep momentum.",
      };
    });
}
